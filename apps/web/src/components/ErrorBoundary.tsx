import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Top-level safety net: render errors show a readable panel instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error', error, info.componentStack);
  }

  render(): JSX.Element | ReactNode {
    if (this.state.error) {
      return (
        <div className="page" style={{ paddingTop: 64 }}>
          <div className="card card-pad-lg" style={{ maxWidth: 720, margin: '0 auto' }}>
            <h2 className="page-title" style={{ marginBottom: 8 }}>
              Something went wrong
            </h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              The interface hit an unexpected error. The details below help diagnose it.
            </p>
            <pre className="mono text-sm" style={{ whiteSpace: 'pre-wrap', color: 'var(--danger)' }}>
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack?.slice(0, 2000)}
            </pre>
            <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
              Back to dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
