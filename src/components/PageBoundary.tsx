import { Component, type ReactNode } from 'react';

/** If one page fails, show a calm message with Retry instead of a blank screen. The rest of the site keeps working. */
export class PageBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Page error:', error); }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="card pb-err" role="alert">
        <b>This page hit a problem.</b>
        <p className="muted">Your account and any running bot are not affected.</p>
        <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Retry</button>
      </section>
    );
  }
}
