import { createContext, useContext, useEffect, useState } from "react";
import { api, TOKEN_KEY } from "../services/api";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setError("");
  }
  async function login(newToken, newUser) {
    if (!newToken) throw new Error("The server did not return a login token.");
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser || null);
  }
  useEffect(() => {
    window.addEventListener("adbloom:unauthorized", logout);
    const sync = (event) => {
      if (event.key === TOKEN_KEY) {
        setToken(event.newValue);
        setUser(null);
      }
    };
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("adbloom:unauthorized", logout);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .me()
      .then((data) => {
        if (active) setUser(data.client);
      })
      .catch((err) => {
        if (active) {
          if (err.status === 401) logout();
          else setError(err.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, retry]);
  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        loading,
        error,
        retry: () => setRetry((x) => x + 1),
        isAuthenticated: Boolean(token),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
