import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

dotenv.config();

// [SEC] Variáveis obrigatórias — servidor não sobe sem elas
const MERCADO_PAGO_WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
if (!MERCADO_PAGO_WEBHOOK_SECRET) {
  console.error('[FATAL] MERCADO_PAGO_WEBHOOK_SECRET não configurado. Defina no .env e reinicie.');
  process.exit(1);
}

const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const app = express();
const PORT = 3000;

// [SEC] Headers de segurança HTTP (helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // necessário para Vite HMR em dev
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://*.supabase.co"],
      connectSrc: ["'self'", supabaseUrl],
    },
  },
}));

// [SEC] Rate limiting — máximo 100 requisições por IP a cada 15 minutos
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});
app.use('/api/', limiter);

// [SEC] Rate limiting mais restrito para o endpoint de registro (anti brute-force)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,                   // máximo 10 tentativas de registro por IP por hora
  message: { error: 'Muitas tentativas de registro. Tente novamente mais tarde.' },
});

// [SEC] CORS restrito — apenas origens conhecidas
const allowedOrigins = [
  'https://slotbarber.com.br',
  process.env.APP_URL || 'http://localhost:3000',
];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Raw body para validação do webhook — deve vir ANTES do express.json()
app.use('/api/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// [SEC] Supabase Admin Client — usado apenas no servidor, nunca exposto ao frontend
const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Mercado Pago
const client = new MercadoPagoConfig({ accessToken: MERCADO_PAGO_ACCESS_TOKEN });

// ---------------------------------------------------------------------------
// ROTAS DE API
// ---------------------------------------------------------------------------

// [SEC] Registro de barbeiro — senha gerenciada pelo Supabase Auth (sem bcrypt manual)
app.post('/api/auth/register', authLimiter, async (req, res) => {
  // [SEC] Guard: garante que o admin client está configurado antes de usar
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Servidor não configurado corretamente. Contate o suporte.' });
  }

  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password e name são obrigatórios.' });
    }

    // [SEC] Validação de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Formato de e-mail inválido.' });
    }

    // [SEC] Senha mínima 8 caracteres
    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
    }

    // [SEC] Limite no tamanho dos campos para evitar payload abuse
    if (name.length > 100 || email.length > 254) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    // [SEC] Supabase Auth gerencia o hash da senha internamente — NÃO fazer bcrypt aqui
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,         // senha original — Supabase faz o hash com bcrypt internamente
      email_confirm: true,
    });

    if (error) throw error;

    // Cria o perfil do barbeiro vinculado ao ID do Supabase Auth
    const { error: profileError } = await supabaseAdmin.from('barbeiros').insert({
      id: data.user!.id,
      email,
      nome: name,
      ativo: true,
    });

    if (profileError) {
      // Rollback: remove o usuário do Auth se o perfil falhar
      await supabaseAdmin.auth.admin.deleteUser(data.user!.id);
      throw profileError;
    }

    res.status(201).json({ user: { id: data.user!.id, email } });
  } catch (error: any) {
    console.error('[/api/auth/register] Erro:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// [SEC] Proxy da IA — GEMINI_API_KEY nunca exposta ao frontend
app.post('/api/ai', async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Serviço de IA não configurado.' });
  }

  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Campo prompt é obrigatório.' });
    }

    // [SEC] Limite de 2000 chars — evita abuso de custo na API da Gemini
    if (prompt.length > 2000) {
      return res.status(400).json({ error: 'Prompt muito longo. Máximo de 2000 caracteres.' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API retornou status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    console.error('[/api/ai] Erro:', error.message);
    res.status(500).json({ error: 'Falha ao processar requisição de IA.' });
  }
});

// Criação de pagamento (Mercado Pago Preference)
app.post('/api/create-payment', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Servidor não configurado corretamente.' });
  }

  try {
    const { email, name, plan, barber_id } = req.body;

    if (!email || !plan || !barber_id) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
    }

    // [SEC] Validar que barber_id é um UUID válido para evitar injection no banco
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(barber_id)) {
      return res.status(400).json({ error: 'barber_id inválido.' });
    }

    // [SEC] Preços definidos no servidor — nunca aceitar valor vindo do frontend
    const prices: Record<string, number> = {
      pro: 29.90,
      premium: 59.90,
    };

    const amount = prices[plan];
    if (!amount) {
      return res.status(400).json({ error: 'Plano inválido.' });
    }

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [
          {
            id: plan,
            title: `Plano ${plan.toUpperCase()} - SlotBarber`,
            quantity: 1,
            unit_price: amount,
            currency_id: 'BRL',
          },
        ],
        payer: { email, name: name || 'Barbeiro' },
        external_reference: JSON.stringify({ barber_id, plan }),
        back_urls: {
          success: `${process.env.APP_URL || 'http://localhost:3000'}/barbearia`,
          failure: `${process.env.APP_URL || 'http://localhost:3000'}/planos`,
          pending: `${process.env.APP_URL || 'http://localhost:3000'}/barbearia`,
        },
        auto_return: 'approved',
        notification_url: `${process.env.APP_URL || 'http://localhost:3000'}/api/webhook`,
      },
    });

    await supabaseAdmin.from('subscriptions').upsert(
      {
        barber_id,
        plan,
        status: 'pending',
        external_id: result.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'external_id' }
    );

    res.json({ id: result.id, url: result.init_point });
  } catch (error: any) {
    console.error('[/api/create-payment] Erro:', error.message);
    res.status(500).json({ error: 'Falha ao criar pagamento.' });
  }
});

// Webhook do Mercado Pago
app.post('/api/webhook', async (req, res) => {
  const rawBody = req.body.toString();
  const signature = req.headers['x-signature'] as string;

  const logEvent = async (
    event: string,
    payload: any,
    status: string,
    error?: string,
    paymentId?: string,
    barberId?: string
  ) => {
    if (supabaseAdmin) {
      await supabaseAdmin.from('webhook_logs').insert({
        evento: event,
        payload,
        status,
        erro: error,
        payment_id: paymentId,
        barber_id: barberId,
        created_at: new Date().toISOString(),
      });
    }
  };

  // [SEC] Validação de assinatura SEMPRE obrigatória (secret garantido no boot)
  if (!signature) {
    await logEvent('invalid_signature', { headers: req.headers }, 'unauthorized', 'Missing x-signature header');
    return res.status(401).send('Unauthorized');
  }

  const hmac = crypto.createHmac('sha256', MERCADO_PAGO_WEBHOOK_SECRET);
  hmac.update(rawBody);
  const calculatedSignature = hmac.digest('hex');

  // Suporta formato ts/v1 do Mercado Pago
  let v1 = '';
  signature.split(',').forEach((part) => {
    const [key, value] = part.split('=');
    if (key === 'v1') v1 = value;
  });

  if (calculatedSignature !== signature && calculatedSignature !== v1) {
    await logEvent(
      'invalid_signature',
      { signature, calculatedSignature, body: rawBody },
      'unauthorized',
      'Invalid HMAC signature'
    );
    return res.status(401).send('Unauthorized');
  }

  try {
    const body = JSON.parse(rawBody);
    const { action, data, type } = body;
    const paymentId = data?.id || body.id;

    if (!paymentId) {
      return res.status(400).send('No payment ID');
    }

    // Idempotência — ignora eventos já processados
    if (supabaseAdmin) {
      const { data: existingLog } = await supabaseAdmin
        .from('webhook_logs')
        .select('id')
        .eq('payment_id', paymentId.toString())
        .eq('status', 'processed')
        .maybeSingle();

      if (existingLog) {
        return res.status(200).send('Already processed');
      }
    }

    if (type === 'payment' || action?.startsWith('payment.')) {
      const payment = new Payment(client);
      const paymentData = await payment.get({ id: paymentId });

      let metadata: any = {};
      try {
        metadata =
          typeof paymentData.external_reference === 'string'
            ? JSON.parse(paymentData.external_reference)
            : paymentData.external_reference;
      } catch {
        console.error('[Webhook] Erro ao parsear external_reference:', paymentData.external_reference);
      }

      const { barber_id, plan } = metadata;

      if (paymentData.status === 'approved' && barber_id && supabaseAdmin) {
        const expiraEm = new Date();
        expiraEm.setDate(expiraEm.getDate() + 30);

        await supabaseAdmin.from('subscriptions').upsert(
          {
            barber_id,
            plan,
            status: 'active',
            expira_em: expiraEm.toISOString(),
            external_id: paymentId.toString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_id' }
        );

        await supabaseAdmin
          .from('barbeiros')
          .update({ plan, ativo: true, expira_em: expiraEm.toISOString() })
          .eq('id', barber_id);

        await logEvent('payment_approved', body, 'processed', undefined, paymentId.toString(), barber_id);
      } else if (
        (paymentData.status === 'rejected' || paymentData.status === 'cancelled') &&
        barber_id &&
        supabaseAdmin
      ) {
        await supabaseAdmin
          .from('subscriptions')
          .update({
            status: paymentData.status === 'cancelled' ? 'canceled' : 'inactive',
            updated_at: new Date().toISOString(),
          })
          .eq('external_id', paymentId.toString());

        await logEvent('payment_failed', body, 'processed', undefined, paymentId.toString(), barber_id);
      }
    }

    if (type === 'subscription' || action?.startsWith('subscription.')) {
      await logEvent('subscription_event', body, 'processed');
    }

    res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Webhook] Error:', error);
    await logEvent('error', { body: rawBody }, 'error', error.message);
    res.status(200).send('OK'); // Mercado Pago exige sempre 200
  }
});

// ---------------------------------------------------------------------------
// VITE MIDDLEWARE / STATIC FILES
// ---------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SlotBarber] Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer();
