import React, { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import browserProcess from "process";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "./style.css";

// Initialize before importing any Solana SDK modules.
const globals = globalThis as any;
globals.Buffer = Buffer;
globals.process = browserProcess;
globals.global = globalThis;

function Failure({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  return <main style={{ maxWidth: 900, margin: "50px auto", padding: 24 }}>
    <h1>Vestra could not start</h1>
    <p style={{ marginTop: 16 }}>Copy the error below so we can fix the startup failure.</p>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 24, color: "#FB7185" }}>{message}</pre>
  </main>;
}
class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? <Failure error={this.state.error} /> : this.props.children; }
}
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<main style={{ padding: 40 }}>Starting Vestra…</main>);
import("./App").then(({ default: App }) => {
  root.render(<React.StrictMode><Boundary><App /></Boundary></React.StrictMode>);
}).catch(error => {
  console.error("Vestra startup:", error);
  root.render(<Failure error={error} />);
});
