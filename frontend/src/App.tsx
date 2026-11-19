import CamerasPage from "./pages/CamerasPage";
import MockSegPreview from "./dev/MockSegPreview";

export default function App() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock")) {
    return <MockSegPreview />;
  }
  return <CamerasPage />;
}
