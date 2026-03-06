import { NavLink } from "react-router-dom";
import { LayoutDashboard, Trophy, Send, Zap, Search, ShoppingCart } from "lucide-react";
import { cn } from "../lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/leaderboard", label: "Leaderboard", Icon: Trophy },
  { to: "/submit", label: "Submit Agent", Icon: Send },
  { to: "/research", label: "Research", Icon: Search },
  { to: "/marketplace", label: "Marketplace", Icon: ShoppingCart },
];

interface LayoutProps {
  children: React.ReactNode;
  isLive?: boolean;
}

export function Layout({ children, isLive = false }: LayoutProps) {
  return (
    <div className="flex h-screen bg-[#0f1117] text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[#2a2d3a] bg-[#1a1d27] flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-[#2a2d3a]">
          <Zap className="h-5 w-5 text-blue-400" />
          <span className="font-bold text-lg tracking-tight">AgentBazaar</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-500/10 text-blue-400"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-[#2a2d3a]">
          <p className="text-xs text-slate-600">Nevermined Hackathon 2026</p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-[#2a2d3a] bg-[#0f1117] flex items-center justify-between px-6 shrink-0">
          <h1 className="text-sm font-medium text-slate-300">AgentBazaar — AI Agent Marketplace</h1>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isLive ? "bg-green-500 animate-pulse" : "bg-slate-600"
              )}
            />
            <span className="text-xs text-slate-400">{isLive ? "Live" : "Offline"}</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
