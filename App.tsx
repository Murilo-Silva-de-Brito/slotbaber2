import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Admin from './pages/Admin';
import Barbeiro from './pages/Barbeiro';
import Agendar from './pages/Agendar';
import Planos from './pages/Planos';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        } />
        {/* [SEC] /barbearia protegida — redireciona para /login se não autenticado */}
        <Route path="/barbearia" element={
          <ProtectedRoute>
            <Barbeiro />
          </ProtectedRoute>
        } />
        <Route path="/planos" element={<Planos />} />
        <Route path="/:slug" element={<Agendar />} />
      </Routes>
    </Router>
  );
}
