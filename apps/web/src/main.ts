import './styles/theme.css'
import './styles/components.css'
import './styles/styles.css'

import "@globular/components/applicationLayout.js";
import './widgets/user_toolbar'
import './widgets/theme_toggle'
import './widgets/peer_discovery'

// css
import "@fortawesome/fontawesome-free/css/all.min.css";
import 'toastify-js/src/toastify.css';

// theme
import { applyTheme, watchSystemTheme } from './theme/theme'

// backend helpers
import {
  Backend,
  getEventClient,
  setNavigateHandler,
} from "@globular/backend";

import { startRouter, navigateTo } from './router'

setNavigateHandler(navigateTo);

Backend.init(() => getEventClient());

applyTheme();
watchSystemTheme();

startRouter()
