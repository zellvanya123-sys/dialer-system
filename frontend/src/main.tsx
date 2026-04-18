import React from 'react'
import ReactDOM from 'react-dom/client'
import { Dashboard } from './pages/Dashboard'
import './index.css'

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string | null}> {
  constructor(props: any) {
    super(props)
    this.state = { error: null }
  }
  componentDidCatch(error: any) {
    this.setState({ error: error?.message || String(error) })
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding: 40, fontFamily: 'monospace', background: '#fee2e2', minHeight: '100vh'}}>
          <h2>❌ Ошибка React:</h2>
          <pre style={{whiteSpace: 'pre-wrap', color: '#991b1b'}}>{this.state.error}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Dashboard />
  </ErrorBoundary>
)
