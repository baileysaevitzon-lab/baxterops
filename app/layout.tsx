import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import { RoleProvider } from "@/components/RoleProvider";
import TopBar from "@/components/TopBar";
import ZenSeedBootstrap from "@/components/ZenSeedBootstrap";
import { SourceLedgerProvider } from "@/components/SourceLedgerProvider";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "BaxterOps — Competitive Intelligence + Recertification",
  description: "Internal platform for The Baxter Hollywood",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Sprint 17: cursive font for typed-signature generation */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>
        <RoleProvider>
          <ZenSeedBootstrap />
          <SourceLedgerProvider>
          <div className="min-h-screen flex">
            <Sidebar />
            <div className="flex-1 min-w-0 flex flex-col">
              <TopBar />
              <main className="p-8 flex-1">{children}</main>
            </div>
          </div>
          </SourceLedgerProvider>
        </RoleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
