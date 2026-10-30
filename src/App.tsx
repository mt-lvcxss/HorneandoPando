import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './app/AppLayout';
import { ConfigErrorPage } from './app/ConfigErrorPage';
import { DashboardPage } from './app/DashboardPage';
import { RequireAccount } from './app/RequireAccount';
import { AuthProvider } from './auth/AuthProvider';
import { ConfirmEmailPage } from './auth/pages/ConfirmEmailPage';
import { ForgotPasswordPage } from './auth/pages/ForgotPasswordPage';
import { LoginPage } from './auth/pages/LoginPage';
import { RegisterPage } from './auth/pages/RegisterPage';
import { ResetPasswordPage } from './auth/pages/ResetPasswordPage';
import { VerifyDevicePage } from './auth/pages/VerifyDevicePage';
import { configResult } from './db/supabase';
import { IngredientDetailPage } from './modules/ingredients/IngredientDetailPage';
import { IngredientsPage } from './modules/ingredients/IngredientsPage';
import { BusinessProfilePage } from './modules/settings/BusinessProfilePage';
import { OperationSettingsPage } from './modules/settings/OperationSettingsPage';

export function App() {
  if (!configResult.ok) return <ConfigErrorPage problems={configResult.problems} />;

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/ingresar" element={<LoginPage />} />
          <Route path="/registro" element={<RegisterPage />} />
          <Route path="/recuperar" element={<ForgotPasswordPage />} />
          <Route path="/auth/confirmado" element={<ConfirmEmailPage />} />
          <Route path="/auth/restablecer" element={<ResetPasswordPage />} />
          <Route path="/verificar-dispositivo" element={<VerifyDevicePage />} />

          <Route element={<RequireAccount />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/ingredientes" element={<IngredientsPage />} />
              <Route path="/ingredientes/:id" element={<IngredientDetailPage />} />
              <Route path="/configuracion/negocio" element={<BusinessProfilePage />} />
              <Route path="/configuracion/operacion" element={<OperationSettingsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
