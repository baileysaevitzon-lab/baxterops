"use client";
import { RoleSwitcher, useRole } from "./RoleProvider";

export default function TopBar() {
  const { user } = useRole();
  return (
    <div className="border-b border-slate-200 bg-white px-8 py-3 flex justify-between items-center">
      <div className="text-xs text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{user.name}</span> ({user.role})
      </div>
      <RoleSwitcher compact />
    </div>
  );
}
