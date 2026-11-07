import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { LibraryProvider } from "./library.tsx";
import { AccountPage } from "./pages/AccountPage.tsx";
import { AllVideosPage } from "./pages/AllVideosPage.tsx";
import { ChannelSettingsPage } from "./pages/ChannelSettingsPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { SeriesPage } from "./pages/SeriesPage.tsx";
import { UserPage } from "./pages/UserPage.tsx";
import { VideoPage } from "./pages/VideoPage.tsx";
import { usePathname, useRoute } from "./router.tsx";
import { SessionProvider } from "./session.tsx";
import { UploadsProvider } from "./uploads.tsx";

export function App() {
  // A new page starts without the error of the page before it.
  const pathname = usePathname();
  return (
    <SessionProvider>
      <LibraryProvider>
        <UploadsProvider>
          <ErrorBoundary key={pathname}>
            <Page />
          </ErrorBoundary>
        </UploadsProvider>
      </LibraryProvider>
    </SessionProvider>
  );
}

function Page() {
  const route = useRoute();
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "all-videos":
      return <AllVideosPage />;
    case "search":
      return <SearchPage />;
    case "history":
      return <HistoryPage />;
    case "channel-settings":
      return <ChannelSettingsPage />;
    case "account":
      return <AccountPage />;
    case "video":
      return <VideoPage key={route.id} id={route.id} />;
    case "series":
      return <SeriesPage key={route.id} id={route.id} />;
    case "user":
      return <UserPage key={route.id} id={route.id} />;
    case "not-found":
      return <NotFoundPage />;
  }
}
