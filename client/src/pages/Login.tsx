import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layout } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState(import.meta.env.VITE_ADMIN_EMAIL ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Credenziali errate");
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setError("Errore di connessione al server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "oklch(0.1 0.01 260)" }}>
      <div className="w-full max-w-sm px-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{ background: "var(--gradient-primary)" }}>
            <Layout className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-1">DreamBrothers Hub</h1>
          <p className="text-sm text-muted-foreground">Inserisci le credenziali per accedere</p>
        </div>

        <div className="space-y-4">
          <Input
            type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.22 0.015 260)", height: "48px" }}
          />
          <Input
            type="password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            style={{ background: "oklch(0.14 0.015 260)", border: "1px solid oklch(0.22 0.015 260)", height: "48px" }}
          />
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}
          <Button
            onClick={handleLogin} disabled={loading || !email || !password}
            className="w-full h-12 font-semibold text-white"
            style={{ background: "var(--gradient-primary)" }}
          >
            {loading ? "Accesso..." : "Accedi"}
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground mt-6">
          Imposta <code className="text-primary">ADMIN_EMAIL</code> e <code className="text-primary">ADMIN_PASSWORD</code> nelle variabili Railway
        </p>
      </div>
    </div>
  );
}
