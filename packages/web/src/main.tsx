import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createBrowserPlatform, browserNavReaders } from './platform/browser'
import { ux } from './platform/ux'
import { setNavReaders } from './lib/nav'
import { configureShell } from './shell'
import './fonts.css'
import './index.css'
import './logbook.css'
import './views/plan.css'
import './views/views.css'
import './views/Programs.css'
const platform=createBrowserPlatform({buildSha:__BUILD_SHA__})
configureShell(platform)
setNavReaders(browserNavReaders(ux().window!))
const win=ux().window!, doc=ux().document!
if ('scrollRestoration' in win.history) win.history.scrollRestoration='manual'
createRoot(doc.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
if (platform.info.canServiceWorker) void platform.registerServiceWorker('sw.js').catch(()=>{})
