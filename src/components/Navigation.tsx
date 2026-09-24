import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  LineChart,
  FileText,
  Activity,
  LogOut,
  Upload,
  Wrench,
  ClipboardList,
  Users,
  BadgeCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Navigation = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { isAdmin, canEdit, loading: rolesLoading } = useRoles();

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/analytics", icon: LineChart, label: "Analytics" },
    { path: "/belts", icon: Wrench, label: "Belts" },
    { path: "/maintenance", icon: ClipboardList, label: "Maintenance" },
    { path: "/reports", icon: FileText, label: "Reports" },
    { path: "/upload", icon: Upload, label: "Upload Analysis" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center gap-4 px-4">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg md:text-xl">
          <Activity className="h-5 w-5 md:h-6 md:w-6 text-primary" />
          <span className="hidden sm:inline">ConveyorWatch</span>
        </Link>

        <div className="flex items-center gap-1 md:gap-2 ml-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Button>
              </Link>
            );
          })}
          {isAdmin && (
            <Link to="/users">
              <Button
                variant={location.pathname === "/users" ? "default" : "ghost"}
                size="sm"
                className="gap-2"
              >
                <Users className="h-4 w-4" />
                <span className="hidden md:inline">Users</span>
              </Button>
            </Link>
          )}
          <ThemeToggle />
          {!rolesLoading && canEdit && (
            <span
              className="hidden lg:flex items-center gap-1 text-xs text-muted-foreground border rounded-md px-2 py-1"
              title={isAdmin ? "Administrator" : "Operator"}
            >
              <BadgeCheck className="h-3 w-3" />
              {isAdmin ? "Admin" : "Operator"}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="gap-2"
            title={`Sign out (${user?.email})`}
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline">Sign Out</span>
          </Button>
        </div>
      </div>
    </nav>
  );
};
