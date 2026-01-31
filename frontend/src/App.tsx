import { Sidebar } from "./components/Sidebar";
import { ChatPage } from "./components/ChatPage";
import { SettingsPage } from "./components/SettingsPage";
import { ArchivesPage, ArchivedConversation } from "./components/ArchivesPage";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import { useState, useRef, useEffect } from "react";
import { authApi, getAuthToken } from "./services/api";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<"chat" | "settings" | "archives">("chat");
  const [archives, setArchives] = useState<ArchivedConversation[]>([]);
  const chatPageRef = useRef<{ clearMessages: () => void; getMessages: () => any[]; restoreMessages: (messages: any[]) => void }>(null);

  // Check authentication on mount
  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      // Verify token is valid
      authApi.getCurrentUser()
        .then(() => setIsAuthenticated(true))
        .catch(() => {
          // Token invalid, remove it
          authApi.logout();
          setIsAuthenticated(false);
        });
    }
  }, []);

  // Load archives from localStorage on mount
  useEffect(() => {
    const savedArchives = localStorage.getItem('inspectre_archives');
    if (savedArchives) {
      try {
        const parsed = JSON.parse(savedArchives);
        // Convert date strings back to Date objects
        const archivesWithDates = parsed.map((archive: any) => ({
          ...archive,
          archivedAt: new Date(archive.archivedAt),
          messages: archive.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp)
          }))
        }));
        setArchives(archivesWithDates);
      } catch (e) {
        console.error('Failed to load archives:', e);
      }
    }
  }, []);

  // Save archives to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('inspectre_archives', JSON.stringify(archives));
  }, [archives]);

  const handleRefreshChat = () => {
    const messages = chatPageRef.current?.getMessages();
    
    // Only archive if there are messages
    if (messages && messages.length > 0) {
      const firstUserMessage = messages.find(m => m.sender === "user");
      const preview = firstUserMessage 
        ? firstUserMessage.text 
        : "Empty conversation";
      
      const newArchive: ArchivedConversation = {
        id: Date.now().toString(),
        messages: messages,
        archivedAt: new Date(),
        preview: preview.substring(0, 100) // Limit preview length
      };

      setArchives(prev => [newArchive, ...prev]);
    }
    
    chatPageRef.current?.clearMessages();
  };

  const handleDeleteArchive = (id: string) => {
    setArchives(prev => prev.filter(archive => archive.id !== id));
  };

  const handleRestoreArchive = (conversation: ArchivedConversation) => {
    chatPageRef.current?.restoreMessages(conversation.messages);
    setCurrentPage("chat");
    setSidebarOpen(false);
  };

  const handleLogin = () => {
    setIsAuthenticated(true);
    setShowRegister(false);
  };

  const handleLogout = () => {
    authApi.logout();
    setIsAuthenticated(false);
  };

  // Show login/register if not authenticated
  if (!isAuthenticated) {
    if (showRegister) {
      return <RegisterPage onRegister={handleLogin} onSwitchToLogin={() => setShowRegister(false)} />;
    }
    return <LoginPage onLogin={handleLogin} onSwitchToRegister={() => setShowRegister(true)} />;
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-white overflow-hidden">
      {/* Sidebar */}
      <Sidebar 
        isOpen={sidebarOpen} 
        onClose={() => setSidebarOpen(false)}
        onNavigate={(page) => {
          setCurrentPage(page);
          setSidebarOpen(false);
        }}
        onRefreshChat={handleRefreshChat}
        onLogout={handleLogout}
      />
      
      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8">
          {currentPage === "chat" && <ChatPage ref={chatPageRef} />}
          {currentPage === "settings" && <SettingsPage />}
          {currentPage === "archives" && (
            <ArchivesPage 
              archives={archives}
              onDeleteArchive={handleDeleteArchive}
              onRestoreArchive={handleRestoreArchive}
            />
          )}
        </div>
      </main>
    </div>
  );
}