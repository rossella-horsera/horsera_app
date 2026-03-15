import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, Flag, TrendingUp, Sparkles, BookOpen } from "lucide-react";
import { motion } from "framer-motion";

const tabs = [
  { path: "/", icon: Home, label: "Home" },
  { path: "/ride", icon: Flag, label: "Ride" },
  { path: "/learn", icon: BookOpen, label: "Learn" },
  { path: "/progress", icon: TrendingUp, label: "Progress" },
  { path: "/genie", icon: Sparkles, label: "Genie" },
];

const AppLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-[100dvh] bg-background max-w-md mx-auto relative">
      <main className="flex-1 overflow-y-auto pb-[72px]">
        <Outlet />
      </main>

      {/* Bottom Navigation — minimal Arc-inspired */}
      <nav className="fixed bottom-0 left-0 right-0 z-50">
        <div className="max-w-md mx-auto">
          <div className="mx-3 mb-2 rounded-2xl bg-card/80 backdrop-blur-2xl border border-border/30 shadow-lg shadow-foreground/[0.03] safe-bottom">
            <div className="flex items-center justify-around px-1 py-2">
              {tabs.map((tab) => {
                const isActive = location.pathname === tab.path;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.path}
                    onClick={() => navigate(tab.path)}
                    className="relative flex flex-col items-center gap-0.5 py-1 px-5 transition-all duration-200"
                  >
                    <div className="relative">
                      <Icon
                        size={20}
                        className={`transition-colors duration-200 ${isActive ? "text-foreground" : "text-muted-foreground/60"}`}
                        strokeWidth={isActive ? 2 : 1.5}
                      />
                      {isActive && (
                        <motion.div
                          layoutId="tab-indicator"
                          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-foreground"
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        />
                      )}
                    </div>
                    <span
                      className={`text-[9px] font-medium tracking-wide transition-colors duration-200 ${
                        isActive ? "text-foreground" : "text-muted-foreground/50"
                      }`}
                    >
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
};

export default AppLayout;