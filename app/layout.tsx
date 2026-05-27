import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";
import { RoleProvider } from "@/components/RoleProvider";
import TopBar from "@/components/TopBar";
import ZenSeedBootstrap from "@/components/ZenSeedBootstrap";
import { SourceLedgerProvider } from "@/components/SourceLedgerProvider";

export const metadata: Metadata = {
  title: "BaxterOps — Competitive Intelligence + Recertification",
  description: "Internal platform for The Baxter Hollywood",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
      </body>
    </html>
  );
}
