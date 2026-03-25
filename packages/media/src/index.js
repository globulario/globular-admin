// @globular/media — barrel file
//
// Importing '@globular/media' registers all media web components as side effects.
// Deep imports (e.g. '@globular/media/audio.js') still work.

// Players
import './audio.js'
import './video.js'
import './playlist.js'

// Media pages
import './watching.js'
import './media/mediaSettings.js'

// Search (media-specific cards + infrastructure)
import './search/search.js'
import './search/searchBar.js'
import './search/searchResults.js'
import './search/searchResultsPage.js'

// Information manager (all info types + editors)
import './informationManager/informationsManager.js'
