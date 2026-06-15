import { Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import DashboardPage from "@/pages/DashboardPage";
import UploadPage from "@/pages/UploadPage";
import TranscriptPage from "@/pages/TranscriptPage";
import LibraryPage from "@/pages/LibraryPage";
import ProtocolPage from "@/pages/ProtocolPage";
import ProtocolsListPage from "@/pages/ProtocolsListPage";
import ChatPage from "@/pages/ChatPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="transcriptions/:id" element={<TranscriptPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="protocols" element={<ProtocolsListPage />} />
        <Route path="protocols/:id" element={<ProtocolPage />} />
        <Route path="chat" element={<ChatPage />} />
      </Route>
    </Routes>
  );
}
