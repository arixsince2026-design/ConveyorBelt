import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useRoles } from "@/hooks/useRoles";
import { errorMessage } from "@/lib/errors";

type AppRole = Database["public"]["Enums"]["app_role"];

interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  roles: string[];
}

const Users = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { user: currentUser } = useAuth();
  const { isAdmin } = useRoles();
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesRes, rolesRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").order("email"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;

      const rolesByUser = new Map<string, string[]>();
      for (const r of rolesRes.data || []) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push(r.role);
        rolesByUser.set(r.user_id, list);
      }

      setUsers(
        (profilesRes.data || []).map((p: { id: string; full_name: string | null; email: string | null }) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          roles: rolesByUser.get(p.id) ?? [],
        }))
      );
    } catch (error: unknown) {
      toast({
        title: "Failed to load users",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin, fetchUsers]);

  const setRole = async (targetUser: UserRow, role: AppRole) => {
    try {
      // Replace the user's roles with the single selected role
      const existing = targetUser.roles;
      if (!existing.includes(role)) {
        const { error: delError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", targetUser.id);
        if (delError) throw delError;
        const { error: insError } = await supabase
          .from("user_roles")
          .insert({ user_id: targetUser.id, role });
        if (insError) throw insError;
      }
      toast({
        title: "Role updated",
        description: `${targetUser.email ?? "User"} is now ${role}.`,
      });
      fetchUsers();
    } catch (error: unknown) {
      toast({ title: "Update failed", description: errorMessage(error), variant: "destructive" });
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3 p-6">
        <ShieldAlert className="h-10 w-10 text-status-critical" />
        <h1 className="text-xl font-semibold">Admin access required</h1>
        <p className="text-sm text-muted-foreground">
          Only administrators can manage user roles.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">User Management</h1>
        <p className="text-sm md:text-base text-muted-foreground">
          Promote or demote users between admin, operator, and viewer roles
        </p>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading users...
        </div>
      ) : (
        <Card className="bg-gradient-to-br from-card to-card/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Current Role</TableHead>
                <TableHead>Change Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email ?? "—"}</TableCell>
                  <TableCell>{u.full_name || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {u.roles.length === 0 ? (
                        <Badge variant="outline">none</Badge>
                      ) : (
                        u.roles.map((r) => (
                          <Badge key={r} variant={r === "admin" ? "destructive" : r === "operator" ? "secondary" : "default"}>
                            {r}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.id === currentUser?.id ? (
                      <span className="text-xs text-muted-foreground">
                        You cannot change your own role
                      </span>
                    ) : (
                      <Select
                        value={u.roles[0] ?? "viewer"}
                        onValueChange={(v) => setRole(u, v as AppRole)}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="operator">Operator</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
};

export default Users;
