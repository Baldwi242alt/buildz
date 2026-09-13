import { Component, type ReactNode } from "react";
import { Brand } from "./ui";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="connection-screen">
        <Brand />
        <h1>This view couldn’t load.</h1>
        <p>
          Refresh to reload BuildZ. Saved server data is unchanged; unsaved
          fields may need to be entered again.
        </p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload BuildZ
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
