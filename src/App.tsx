import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { useEffect, useState } from "react";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import { HomePage } from "./pages/home";
import InsedgeLandingPage from "./pages/insedge-landing";
import { DashboardPage } from "./pages/dashboard";
import { SensorDetailPage } from "./pages/sensor-detail";
import { PublicSensorDetailPage } from "./pages/public-sensor-detail";
import { AuditPage } from "./pages/audit";
import PublicSensorsPage from "./pages/public-sensors";
import { Sensor, Dataset } from "./lib/types";
import { Toaster } from "./components/ui/sonner";
import { Button } from "./components/ui/button";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { sensorAPI, publicAPI } from "./lib/api";
import { ThemeProvider } from "next-themes@0.4.6";

function HomeWrapper() {
  const navigate = useNavigate();
  return (
    <HomePage onGetStarted={() => navigate("/dashboard")} />
  );
}

function DashboardWrapper() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) {
      navigate("/");
    }
  }, [user, navigate]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="animate-pulse"
          style={{ color: "var(--text-primary)" }}
        >
          Loading...
        </div>
      </div>
    );
  }

  return (
    <DashboardPage
      onViewSensor={(sensor) =>
        navigate(`/sensor/${sensor.id}`)
      }
    />
  );
}

function SensorDetailWrapper() {
  const navigate = useNavigate();
  const location = useLocation();
  const { accessToken, user } = useAuth();
  const sensorId = location.pathname.split("/").pop();

  useEffect(() => {
    if (!user) {
      navigate("/");
    }
  }, [user, navigate]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="animate-pulse"
          style={{ color: "var(--text-primary)" }}
        >
          Loading...
        </div>
      </div>
    );
  }

  return (
    <SensorDetailWrapperContent
      sensorId={sensorId}
      navigate={navigate}
      accessToken={accessToken}
    />
  );
}

function SensorDetailWrapperContent({
  sensorId,
  navigate,
  accessToken,
}: {
  sensorId: string | undefined;
  navigate: any;
  accessToken: string | null;
}) {
  const location = useLocation();
  const [sensor, setSensor] = useState<Sensor | null>(
    location.state?.sensor || null,
  );

  useEffect(() => {
    if (!sensor && sensorId && accessToken) {
      sensorAPI
        .get(sensorId, accessToken)
        .then(setSensor)
        .catch(console.error);
    }
  }, [sensorId, accessToken]);

  if (!sensor) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="animate-pulse"
          style={{ color: "var(--text-primary)" }}
        >
          Loading sensor...
        </div>
      </div>
    );
  }

  return (
    <SensorDetailPage
      sensor={sensor}
      onBack={() => navigate("/dashboard")}
      onViewAudit={(dataset, sensor) =>
        navigate(`/audit?dataset=${dataset.id}`, {
          state: { dataset, sensor },
        })
      }
    />
  );
}

function AuditWrapper() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const dataset = location.state?.dataset || null;
  const sensor = location.state?.sensor || null;

  // Check if this is a public sensor view (not a specific dataset audit)
  const publicSensorId = searchParams.get("sensor");
  const datasetId = searchParams.get("dataset");

  if (publicSensorId && !datasetId) {
    // Public sensor detail view - show real-time data + datasets
    return (
      <PublicSensorDetailWrapper sensorId={publicSensorId} />
    );
  }

  if (publicSensorId && datasetId) {
    // Public dataset audit view
    return (
      <AuditPage
        onBack={() =>
          navigate(`/audit?sensor=${publicSensorId}`)
        }
      />
    );
  }

  if (!dataset || !sensor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p
            style={{
              color: "var(--text-primary)",
              marginBottom: "16px",
            }}
          >
            No dataset selected
          </p>
          <Button
            onClick={() => navigate("/")}
            variant="outline"
          >
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AuditPage
      dataset={dataset}
      sensor={sensor}
      onBack={() => navigate(`/sensor/${sensor.id}`)}
    />
  );
}

function PublicSensorDetailWrapper({
  sensorId,
}: {
  sensorId: string;
}) {
  const navigate = useNavigate();
  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSensor = async () => {
      try {
        setLoading(true);
        const data = await publicAPI.getPublicSensor(sensorId);
        // Parse dates
        const parsedSensor = {
          ...data,
          createdAt: new Date(data.createdAt),
          updatedAt: data.updatedAt
            ? new Date(data.updatedAt)
            : undefined,
          lastReading: data.lastReading
            ? {
                ...data.lastReading,
                timestamp: new Date(data.lastReading.timestamp),
              }
            : undefined,
        };
        setSensor(parsedSensor);
      } catch (error) {
        console.error("Failed to load public sensor:", error);
      } finally {
        setLoading(false);
      }
    };

    loadSensor();
  }, [sensorId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div
          className="animate-pulse"
          style={{ color: "var(--text-primary)" }}
        >
          Loading sensor...
        </div>
      </div>
    );
  }

  if (!sensor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p
            style={{
              color: "var(--text-primary)",
              marginBottom: "16px",
            }}
          >
            Sensor not found
          </p>
          <Button
            onClick={() => navigate("/public-sensors")}
            variant="outline"
          >
            Back to Public Sensors
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PublicSensorDetailPage
      sensor={sensor}
      onBack={() => navigate("/public-sensors")}
      onViewAudit={(dataset, sensor) =>
        navigate(
          `/audit?sensor=${sensor.id}&dataset=${dataset.id}`,
          { state: { dataset, sensor } },
        )
      }
    />
  );
}

function AppContent() {
  const location = useLocation();
  const isAuditPage = location.pathname === "/audit";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
          },
        }}
      />

      {!isAuditPage && <Header />}

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<InsedgeLandingPage />} />
          <Route path="/edge-tracker" element={<HomeWrapper />} />
          <Route
            path="/preview_page.html"
            element={<HomeWrapper />}
          />
          <Route
            path="/dashboard"
            element={<DashboardWrapper />}
          />
          <Route
            path="/sensor/:id"
            element={<SensorDetailWrapper />}
          />
          <Route path="/audit" element={<AuditWrapper />} />
          <Route
            path="/public-sensors"
            element={<PublicSensorsPage />}
          />
          <Route path="*" element={<InsedgeLandingPage />} />
        </Routes>
      </main>

      {!isAuditPage && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      storageKey="sparked-sense-theme"
      disableTransitionOnChange
    >
      <AuthProvider>
        <Router>
          <AppContent />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}