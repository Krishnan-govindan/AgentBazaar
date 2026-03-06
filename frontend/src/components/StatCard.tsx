import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  Icon: LucideIcon;
  iconColor?: string;
}

export function StatCard({ label, value, Icon, iconColor = "text-blue-400" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-[#2a2d3a] bg-[#1a1d27] p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{label}</p>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
