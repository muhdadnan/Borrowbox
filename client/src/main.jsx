import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('BorrowBox frontend error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-page" role="alert">
          <h1>Something went wrong</h1>
          <p>Sorry about that. Reload BorrowBox to try again.</p>
          <button className="primary-button" onClick={() => window.location.reload()} type="button">Reload</button>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
