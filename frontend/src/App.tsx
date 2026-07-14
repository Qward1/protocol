import { Routes, Route, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import Layout from "@/components/Layout";
import DashboardPage from "@/pages/DashboardPage";
import UploadPage from "@/pages/UploadPage";
import TranscriptPage from "@/pages/TranscriptPage";
import LibraryPage from "@/pages/LibraryPage";
import ProtocolPage from "@/pages/ProtocolPage";
import ProtocolsListPage from "@/pages/ProtocolsListPage";
import ChatPage from "@/pages/ChatPage";
import LoginPage from "@/pages/LoginPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui";

/** Пускает на маршрут, только если у роли есть нужное право; иначе — на дашборд. */
function RequirePerm({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...perms) ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { loading, authEnabled, authenticated } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-7 w-7 text-accent" />
      </div>
    );
  }

  // Авторизация включена и пользователь не вошёл — показываем экран входа.
  if (authEnabled && !authenticated) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            <RequirePerm perms={["dashboard.view", "tasks.view_own", "tasks.view_all"]}>
              <DashboardPage />
            </RequirePerm>
          }
        />
        <Route
          path="upload"
          element={
            <RequirePerm perms={["upload"]}>
              <UploadPage />
            </RequirePerm>
          }
        />
        <Route
          path="transcriptions/:id"
          element={
            <RequirePerm perms={["transcripts.view"]}>
              <TranscriptPage />
            </RequirePerm>
          }
        />
        <Route
          path="library"
          element={
            <RequirePerm perms={["library.view"]}>
              <LibraryPage />
            </RequirePerm>
          }
        />
        <Route
          path="protocols"
          element={
            <RequirePerm perms={["protocols.view"]}>
              <ProtocolsListPage />
            </RequirePerm>
          }
        />
        <Route
          path="protocols/:id"
          element={
            <RequirePerm perms={["protocols.view"]}>
              <ProtocolPage />
            </RequirePerm>
          }
        />
        <Route
          path="chat"
          element={
            <RequirePerm perms={["qa.use"]}>
              <ChatPage />
            </RequirePerm>
          }
        />
        <Route
          path="users"
          element={
            <RequirePerm perms={["users.manage"]}>
              <AdminUsersPage />
            </RequirePerm>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
