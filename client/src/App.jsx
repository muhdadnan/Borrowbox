import { useEffect, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
let googleMapsApiPromise = null
const geocodedLocations = new Map()

function loadGoogleMapsApi() {
  if (window.google?.maps?.Geocoder) return Promise.resolve(window.google.maps)
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('Nearby search needs a Google Maps API key. Add VITE_GOOGLE_MAPS_API_KEY to client/.env.local.'))
  }
  if (!googleMapsApiPromise) {
    googleMapsApiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&v=weekly`
      script.async = true
      script.dataset.borrowboxGoogleMaps = 'true'
      script.onload = () => {
        if (window.google?.maps?.Geocoder) {
          resolve(window.google.maps)
        } else {
          googleMapsApiPromise = null
          script.remove()
          reject(new Error('Google Maps loaded without its geocoding service. Check the enabled APIs for your key.'))
        }
      }
      script.onerror = () => {
        googleMapsApiPromise = null
        script.remove()
        reject(new Error('Google Maps could not load. Check the API key, enabled services, and connection.'))
      }
      document.head.appendChild(script)
    })
  }
  return googleMapsApiPromise
}

function geocodeLocation(location, geocoder) {
  const cacheKey = location.trim().toLowerCase()
  if (!geocodedLocations.has(cacheKey)) {
    const request = geocoder.geocode({ address: location })
      .then(({ results }) => {
        if (!results.length) throw new Error('No matching location')
        const point = results[0].geometry.location
        return { latitude: point.lat(), longitude: point.lng() }
      })
      .catch((error) => {
        geocodedLocations.delete(cacheKey)
        throw error
      })
    geocodedLocations.set(cacheKey, request)
  }
  return geocodedLocations.get(cacheKey)
}

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access in your browser to find nearby items.'
          : error.code === error.TIMEOUT
            ? 'Your location could not be found in time. Try again.'
            : 'Your location is unavailable. Check your device location settings and try again.'
        reject(new Error(message))
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
    )
  })
}

function distanceBetween(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDifference = radians(second.latitude - first.latitude)
  const longitudeDifference = radians(second.longitude - first.longitude)
  const value = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDifference / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function formatDistance(distance) {
  return distance < 1 ? `${Math.round(distance * 1000)} m away` : `${distance.toFixed(1)} km away`
}

async function apiRequest(path, { token, ...options } = {}) {
  const headers = { ...options.headers }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const sessionExpired = response.status === 401 && !['/auth/login', '/auth/register'].includes(path)
    if (sessionExpired) {
      window.dispatchEvent(new CustomEvent('borrowbox:session-expired'))
    }
    const requestError = new Error(data.error || 'The request could not be completed')
    requestError.status = response.status
    requestError.sessionExpired = sessionExpired
    throw requestError
  }
  return data
}

async function uploadImages(files, token) {
  const formData = new FormData()
  files.forEach((file) => formData.append('images', file))
  const response = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const sessionExpired = response.status === 401
    if (sessionExpired) {
      window.dispatchEvent(new CustomEvent('borrowbox:session-expired'))
    }
    const uploadError = new Error(data.error || 'The request could not be completed')
    uploadError.sessionExpired = sessionExpired
    throw uploadError
  }
  if (!Array.isArray(data.urls)) {
    throw new Error('The server did not return uploaded image URLs')
  }
  return data.urls
}

function localDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validateForm(form) {
  const errors = {}
  for (const field of Array.from(form.elements)) {
    if (!field.name || field.disabled || !('value' in field)) continue
    const value = String(field.value || '').trim()
    if (field.required && !value) {
      errors[field.name] = 'This field is required.'
    } else if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field.name] = 'Enter a valid email address.'
    } else if (value && field.name === 'password' && value.length < 8) {
      errors[field.name] = 'Use at least 8 characters.'
    } else if (value && field.type === 'number' && Number(value) < Number(field.min || 0)) {
      errors[field.name] = field.name === 'max_days' ? 'Borrow time must be at least 1 day.' : 'Enter a value of 0 or more.'
    }
  }
  return errors
}

function FieldError({ id, message }) {
  return message ? <span className="field-error" id={id} role="alert">{message}</span> : null
}

function restoreDialogFocus(element) {
  if (element?.isConnected) element.focus()
  else document.querySelector('.topbar .brand')?.focus()
}

const today = localDateString(new Date())

const infoSections = {
  'how-it-works': {
    title: 'How it works',
    intro: 'BorrowBox makes it easy to share useful items with your neighborhood without buying things you may only need once.',
    content: [
      {
        step: '1',
        title: 'List what you have',
        text: 'Post a photo, a short description, and a few details about the item. Set your pickup location, deposit, and how long people can borrow it.',
      },
      {
        step: '2',
        title: 'Request a borrow',
        text: 'Browse nearby listings, filter by category or location, and send a request with your preferred dates and purpose.',
      },
      {
        step: '3',
        title: 'Meet and hand over',
        text: 'Once a request is approved, agree on where and when to swap items. We suggest a quick check of condition before the handoff.',
      },
      {
        step: '4',
        title: 'Return and review',
        text: 'Return the item on time, confirm its return in the app, and leave a quick review so the next borrower knows what to expect.',
      },
    ],
  },
  faq: {
    title: 'FAQ',
    intro: 'A few common questions from the BorrowBox community.',
    content: [
      {
        question: 'What if an item is damaged or goes missing?',
        answer: 'Please message the other person right away and use the report-a-problem option in the app. We recommend documenting the condition before handoff and keeping your deposit details clear.',
      },
      {
        question: 'What is a deposit?',
        answer: 'A deposit is a small amount set by the owner to help cover risk and encourage careful use. It is usually refunded when the item is returned in good condition.',
      },
      {
        question: 'How do trust scores work?',
        answer: 'Trust scores are based on ratings and reviews from previous borrowing and lending experiences. They help people make more confident decisions when sharing items locally.',
      },
      {
        question: 'How do I report a problem?',
        answer: 'Open the request or item thread and choose “report a problem.” Include what happened, when it happened, and any photos if relevant. The community can then respond quickly.',
      },
      {
        question: 'Can I borrow for longer than the listed window?',
        answer: 'Yes, if the owner agrees. Message the owner to ask for an extension before the due date, and keep the dates updated in the request.',
      },
      {
        question: 'What if the owner cancels?',
        answer: 'You will be notified in the app. Please message the owner to understand the next step, and if needed, look for another nearby option or ask for a refund of any deposit arrangement you agreed to.',
      },
      {
        question: 'Do I need to meet in person?',
        answer: 'Most exchanges happen in a safe, public place or a shared community meeting spot. If you are unsure, arrange a location that feels comfortable for both sides.',
      },
      {
        question: 'Can I leave a review?',
        answer: 'Yes. After a checkout is complete, both borrowers and lenders can leave a short review to help build trust across the community.',
      },
    ],
  },
  about: {
    title: 'About',
    intro: 'BorrowBox is a neighborhood lending platform built around practical community care.',
    content: [
      'Borrow instead of buy. Save money, reduce clutter, and make better use of the things already around you.',
      'We help neighbors share resources, support one another, and keep useful items in circulation for longer.',
      'BorrowBox is designed for local communities that value affordability, trust, and shared convenience.',
    ],
  },
  terms: {
    title: 'Terms',
    intro: 'Draft terms for a community lending platform. This is plain-English text and subject to review before launch.',
    content: [
      'BorrowBox is a platform for arranging local item sharing between members. We do not own or supervise every item listed on the site, and we are not a traditional retailer or rental business.',
      'Users are responsible for the accuracy of their listings, the condition of their items, and the messages they send to other members. Borrowers should check the item details before confirming a request.',
      'All borrowing arrangements are made directly between the owner and the borrower. BorrowBox encourages good communication, clear dates, and respectful handling of deposits and returns.',
      'When a request is approved, both parties agree to meet the terms of the listing, including the borrow period, care expectations, and any deposit arrangement. If something goes wrong, members should contact each other promptly and use the reporting tools available in the app.',
      'BorrowBox may update these terms over time. Continued use of the platform means you accept the latest version of this draft policy.',
    ],
  },
  privacy: {
    title: 'Privacy',
    intro: 'Draft privacy information in plain English. This is a starting point for a community lending service.',
    content: [
      'We collect basic profile information needed to run the marketplace, such as your name, contact details, location, and account activity.',
      'This information is used to support sign in, listings, requests, notifications, and community trust features such as reviews and ratings.',
      'We do not sell personal information. We may share only what is necessary to support a lending transaction, such as the item title, location, and public profile details in the BorrowBox app.',
      'You can choose what information you share in your profile and listing. Please avoid posting personal details that are not needed for a safe handoff, such as full home addresses or sensitive private information.',
      'We use reasonable security measures to protect account data in the app, but no platform can guarantee total protection. Please keep your password secure and report anything suspicious.',
    ],
  },
}

function App() {
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [token, setToken] = useState(() => localStorage.getItem('borrowbox_token') || '')
  const [user, setUser] = useState(null)
  const [authMode, setAuthMode] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authFieldErrors, setAuthFieldErrors] = useState({})
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [itemDetail, setItemDetail] = useState(null)
  const [detailError, setDetailError] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestFieldErrors, setRequestFieldErrors] = useState({})
  const [requestStartDate, setRequestStartDate] = useState('')
  const [requestReturnDate, setRequestReturnDate] = useState('')
  const [activeView, setActiveView] = useState('browse')
  const [dashboard, setDashboard] = useState({ listings: [], mine: [], incoming: [] })
  const [dashboardError, setDashboardError] = useState('')
  const [showListingForm, setShowListingForm] = useState(false)
  const [listingError, setListingError] = useState('')
  const [listingBusy, setListingBusy] = useState(false)
  const [listingFieldErrors, setListingFieldErrors] = useState({})
  const [listingFiles, setListingFiles] = useState([])
  const [listingFileError, setListingFileError] = useState('')
  const [pendingAction, setPendingAction] = useState('')
  const [listingInitial, setListingInitial] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState('')
  const [profileItems, setProfileItems] = useState([])
  const [showProfile, setShowProfile] = useState(false)
  const [reviewingRequestId, setReviewingRequestId] = useState(null)
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewFieldErrors, setReviewFieldErrors] = useState({})
  const [infoPage, setInfoPage] = useState(null)
  const [toasts, setToasts] = useState([])
  const [sortBy, setSortBy] = useState('newest')
  const [nearbyDistances, setNearbyDistances] = useState({})
  const [nearbyBusy, setNearbyBusy] = useState(false)
  const [nearbyMessage, setNearbyMessage] = useState('')
  const [nearbyError, setNearbyError] = useState('')
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const authSubmitting = useRef(false)
  const requestSubmitting = useRef(false)
  const listingSubmitting = useRef(false)
  const reviewSubmitting = useRef(false)
  const activeDialogRef = useRef(false)
  const returnFocusRef = useRef(null)
  const previousDialogKeyRef = useRef('')
  const dialogReturnFocusRef = useRef(new Map())
  const sessionExpiryHandled = useRef(false)
  const listingPreviewUrlsRef = useRef(new Set())
  const nearbyRunRef = useRef(0)

  useEffect(() => {
    const previewUrls = listingPreviewUrlsRef.current
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url))
      previewUrls.clear()
    }
  }, [])

  function pushToast(type, message) {
    const toast = { id: Date.now() + Math.random(), type, message }
    setToasts((current) => [...current, toast])
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== toast.id))
    }, 3600)
  }

  function resetNearbyResults() {
    nearbyRunRef.current += 1
    setNearbyDistances({})
    setNearbyBusy(false)
    setNearbyMessage('')
    setNearbyError('')
    setSortBy((current) => current === 'distance' ? 'newest' : current)
  }

  async function findNearbyItems() {
    const runId = nearbyRunRef.current + 1
    nearbyRunRef.current = runId
    if (!GOOGLE_MAPS_API_KEY) {
      setNearbyMessage('')
      setNearbyError('Nearby search needs a Google Maps API key. Add VITE_GOOGLE_MAPS_API_KEY to client/.env.local.')
      return
    }
    setNearbyBusy(true)
    setNearbyError('')
    setNearbyMessage('Finding your location and estimating distances...')
    try {
      if (!navigator.geolocation) {
        throw new Error('Location access is not available in this browser.')
      }
      const origin = await getBrowserLocation()
      if (nearbyRunRef.current !== runId) return
      const maps = await loadGoogleMapsApi()
      if (nearbyRunRef.current !== runId) return

      const locations = [...new Set(items
        .map((item) => String(item.location || '').trim())
        .filter((itemLocation) => itemLocation && !/shared after request/i.test(itemLocation)))]
      if (locations.length === 0) {
        setNearbyMessage('')
        setNearbyError('These listings do not include locations that can be used to calculate distances.')
        return
      }

      const geocoder = new maps.Geocoder()
      const coordinatesByLocation = new Map()
      let nextLocationIndex = 0
      let failedLocations = 0
      const workerCount = Math.min(4, locations.length)
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextLocationIndex < locations.length) {
          const currentLocation = locations[nextLocationIndex]
          nextLocationIndex += 1
          try {
            coordinatesByLocation.set(currentLocation, await geocodeLocation(currentLocation, geocoder))
          } catch {
            failedLocations += 1
          }
        }
      }))
      if (nearbyRunRef.current !== runId) return

      const distances = Object.fromEntries(items.flatMap((item) => {
        const point = coordinatesByLocation.get(String(item.location || '').trim())
        return point ? [[item.id, distanceBetween(origin, point)]] : []
      }))
      if (Object.keys(distances).length === 0) {
        setNearbyMessage('')
        setNearbyError('Could not find distances for these listings. Check that the Google Geocoding API is enabled and the listing locations are searchable.')
        return
      }

      setNearbyDistances(distances)
      setSortBy('distance')
      setNearbyMessage(`Distances are approximate. Google Maps receives listing location text to geocode.${failedLocations ? ` Could not locate ${failedLocations} listing location${failedLocations === 1 ? '' : 's'}.` : ''}`)
    } catch (nearbyRequestError) {
      if (nearbyRunRef.current === runId) {
        setNearbyMessage('')
        setNearbyError(nearbyRequestError.message)
      }
    } finally {
      if (nearbyRunRef.current === runId) setNearbyBusy(false)
    }
  }

  function updateFieldErrors(setErrors, event) {
    const field = event.target
    const form = field.form
    if (!form || !field.name) return
    const formErrors = validateForm(form)
    setErrors((current) => {
      if (!(field.name in current)) return current
      const next = { ...current }
      if (formErrors[field.name]) next[field.name] = formErrors[field.name]
      else delete next[field.name]
      return next
    })
  }

  function handleRequestDateChange(event) {
    const { name, value } = event.target
    const nextStartDate = name === 'start_date' ? value : requestStartDate
    const nextReturnDate = name === 'return_date' ? value : requestReturnDate
    if (name === 'start_date') setRequestStartDate(value)
    if (name === 'return_date') setRequestReturnDate(value)

    updateFieldErrors(setRequestFieldErrors, event)
    setRequestFieldErrors((current) => {
      const next = { ...current }
      if (nextStartDate && nextStartDate < today) next.start_date = 'Choose today or a later date.'
      else if (next.start_date === 'Choose today or a later date.') delete next.start_date
      if (nextStartDate && nextReturnDate && nextReturnDate < nextStartDate) {
        next.return_date = 'Choose a return date on or after the start date.'
      } else if (next.return_date === 'Choose a return date on or after the start date.') {
        delete next.return_date
      }
      if (nextReturnDate && nextReturnDate < (nextStartDate || today)) {
        next.return_date = 'Choose a return date on or after the start date.'
      }
      if (nextStartDate && nextReturnDate && nextReturnDate >= nextStartDate) {
        const days = Math.max(1, Math.round((Date.parse(`${nextReturnDate}T00:00:00Z`) - Date.parse(`${nextStartDate}T00:00:00Z`)) / 86400000))
        const maxDays = Number(detail?.max_days || 7)
        if (days > maxDays) next.return_date = `This item can be borrowed for up to ${maxDays} days.`
        else if (next.return_date?.startsWith('This item can be borrowed for up to')) delete next.return_date
      }
      return next
    })
  }

  function logOut() {
    localStorage.removeItem('borrowbox_token')
    setToken('')
    setUser(null)
    setActiveView('browse')
    setNotificationsOpen(false)
    setMobileMenuOpen(false)
  }

  function requestLogoutConfirmation() {
    setConfirmation({
      title: 'Sign out of BorrowBox?',
      message: 'You can sign in again any time to manage your listings and requests.',
      confirmLabel: 'Sign out',
      onConfirm: () => {
        logOut()
        pushToast('success', 'You have signed out.')
      },
    })
  }

  function closeAuth() {
    setAuthMode('')
    setAuthFieldErrors({})
    setPasswordVisible(false)
  }

  function openAuth(mode) {
    setAuthError('')
    setAuthFieldErrors({})
    setPasswordVisible(false)
    setAuthMode(mode)
  }

  async function confirmAction() {
    if (!confirmation || confirmationBusy) return
    setConfirmationBusy(true)
    try {
      await confirmation.onConfirm()
      setConfirmation(null)
    } catch (confirmationError) {
      pushToast('error', confirmationError.message || 'That action could not be completed.')
    } finally {
      setConfirmationBusy(false)
    }
  }

  const activeDialogKey = confirmation ? 'confirmation'
    : authMode ? 'auth'
    : infoPage ? 'info'
      : showProfile ? 'profile'
        : showListingForm ? 'listing'
          : lightboxOpen ? 'lightbox'
            : selectedItem ? 'item'
              : ''

  useEffect(() => {
    const handleSessionExpired = () => {
      if (sessionExpiryHandled.current) return
      sessionExpiryHandled.current = true
      logOut()
      setSelectedItem(null)
      setShowProfile(false)
      setShowListingForm(false)
      setLightboxOpen(false)
      setInfoPage(null)
      setConfirmation(null)
      setAuthError('')
      openAuth('login')
      returnFocusRef.current = null
      pushToast('error', 'Your session expired, please sign in again')
    }
    window.addEventListener('borrowbox:session-expired', handleSessionExpired)
    return () => window.removeEventListener('borrowbox:session-expired', handleSessionExpired)
  }, [])

  useEffect(() => {
    const previousKey = previousDialogKeyRef.current
    if (!activeDialogKey) {
      if (activeDialogRef.current) {
        activeDialogRef.current = false
        previousDialogKeyRef.current = ''
        const dialogTrigger = dialogReturnFocusRef.current.get(previousKey)
        const focusTarget = dialogTrigger || returnFocusRef.current
        restoreDialogFocus(focusTarget)
        dialogReturnFocusRef.current.clear()
        returnFocusRef.current = null
      }
      return
    }

    let enteringDialog = false
    if (!activeDialogRef.current) {
      returnFocusRef.current = document.activeElement
      activeDialogRef.current = true
      enteringDialog = true
      dialogReturnFocusRef.current.set(activeDialogKey, document.activeElement)
    } else if (activeDialogKey !== previousKey && previousKey) {
      enteringDialog = !dialogReturnFocusRef.current.has(activeDialogKey)
      if (enteringDialog) dialogReturnFocusRef.current.set(activeDialogKey, document.activeElement)
    }
    previousDialogKeyRef.current = activeDialogKey

    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
    const dialog = authMode
      ? document.querySelector('.auth-layer [role="dialog"]')
      : dialogs[dialogs.length - 1]
    if (!dialog) return
    const firstFocusable = dialog.querySelector('input:not([type="hidden"]), select, textarea, button:not(.modal-close)') || dialog.querySelector('button') || dialog
    if (activeDialogKey !== previousKey && previousKey && !enteringDialog) {
      restoreDialogFocus(dialogReturnFocusRef.current.get(previousKey))
    } else {
      firstFocusable.focus()
    }

    const handleDialogKeys = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmation) setConfirmation(null)
        else if (authMode) closeAuth()
        else if (infoPage) setInfoPage(null)
        else if (showProfile) closeProfile()
        else if (showListingForm) closeListingForm()
        else if (lightboxOpen) closeLightbox()
        else if (selectedItem) closeDetails()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeys)
    return () => document.removeEventListener('keydown', handleDialogKeys)
  }, [activeDialogKey, authMode, confirmation, infoPage, lightboxOpen, selectedItem, showListingForm, showProfile])

  useEffect(() => {
    document.title = 'BorrowBox | Borrow locally'
  }, [])

  useEffect(() => {
    const syncProfileRoute = () => {
      const match = window.location.pathname.match(/^\/profile\/(\d+)$/)
      if (match) {
        openProfile(Number(match[1]))
        return
      }
      setShowProfile(false)
    }

    syncProfileRoute()
    window.addEventListener('popstate', syncProfileRoute)
    return () => window.removeEventListener('popstate', syncProfileRoute)
  }, [])

  useEffect(() => {
    apiRequest('/categories')
      .then((data) => setCategories(data.categories || []))
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ available: 'true' })
    if (search.trim()) params.set('q', search.trim())
    if (location.trim()) params.set('location', location.trim())
    if (category) params.set('category', category)

    apiRequest(`/items?${params}`, { signal: controller.signal })
      .then((data) => setItems(data.items || []))
      .catch((fetchError) => {
        if (fetchError.name !== 'AbortError' && !fetchError.sessionExpired) {
          setError('Could not connect to the marketplace. Check that the server is running.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [search, location, category, retry])

  useEffect(() => {
    if (!token) return
    let active = true
    apiRequest('/auth/me', { token })
      .then(({ user: currentUser }) => {
        if (active) setUser(currentUser)
      })
      .catch(() => {
        if (!active) return
        localStorage.removeItem('borrowbox_token')
        setToken('')
        setUser(null)
      })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (activeView !== 'account' || !token) {
      setDashboardLoading(false)
      return
    }

    let active = true
    setDashboardLoading(true)
    Promise.all([
      apiRequest('/items/mine', { token }),
      apiRequest('/requests/mine', { token }),
      apiRequest('/requests/incoming', { token }),
    ])
      .then(([listings, mine, incoming]) => {
        if (active) {
          setDashboard({
            listings: listings.items || [],
            mine: mine.requests || [],
            incoming: incoming.requests || [],
          })
        }
      })
      .catch((fetchError) => {
        if (active && !fetchError.sessionExpired) setDashboardError(fetchError.message)
      })
      .finally(() => {
        if (active) setDashboardLoading(false)
      })
    return () => { active = false }
  }, [activeView, token, retry])

  useEffect(() => {
    if (!token || !notificationsOpen) return
    let active = true
    apiRequest('/notifications', { token })
      .then((data) => {
        if (!active) return
        setNotifications(data.notifications || [])
        setUnreadCount(data.unread_count || 0)
      })
      .catch((notificationRequestError) => {
        if (active && !notificationRequestError.sessionExpired) setNotificationError(notificationRequestError.message)
      })
    return () => { active = false }
  }, [token, notificationsOpen, retry])

  useEffect(() => {
    if (!selectedItem) return
    let active = true
    apiRequest(`/items/${selectedItem.id}`)
      .then(({ item }) => {
        if (active) setItemDetail(item)
      })
      .catch((fetchError) => {
        if (active && !fetchError.sessionExpired) setDetailError(fetchError.message)
      })
    return () => { active = false }
  }, [selectedItem])

  async function handleAuthSubmit(event) {
    event.preventDefault()
    if (authSubmitting.current) return
    const formErrors = validateForm(event.currentTarget)
    setAuthFieldErrors(formErrors)
    if (Object.keys(formErrors).length) {
      event.currentTarget.querySelector(`[name="${Object.keys(formErrors)[0]}"]`)?.focus()
      return
    }
    authSubmitting.current = true
    setAuthError('')
    setAuthBusy(true)
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      if (authMode === 'register') {
        await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: values.name,
            email: values.email,
            password: values.password,
            phone: values.phone,
            location: values.location,
          }),
        })
      }
      const result = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: values.email, password: values.password }),
      })
      localStorage.setItem('borrowbox_token', result.token)
      sessionExpiryHandled.current = false
      setToken(result.token)
      setUser(result.user)
      closeAuth()
      pushToast('success', authMode === 'register' ? 'Account created. Welcome to BorrowBox.' : 'Signed in successfully.')
    } catch (authRequestError) {
      const message = authRequestError.message
      setAuthError(message)
      if (!authRequestError.sessionExpired) pushToast('error', message)
    } finally {
      authSubmitting.current = false
      setAuthBusy(false)
    }
  }

  async function handleBorrowSubmit(event) {
    event.preventDefault()
    if (requestSubmitting.current) return
    const form = event.currentTarget
    const formErrors = validateForm(form)
    if (requestStartDate && requestStartDate < today) {
      formErrors.start_date = 'Choose today or a later date.'
    }
    if (requestStartDate && requestReturnDate && requestReturnDate < requestStartDate) {
      formErrors.return_date = 'Choose a return date on or after the start date.'
    }
    const requestedDays = requestStartDate && requestReturnDate
      ? Math.max(1, Math.round((Date.parse(`${requestReturnDate}T00:00:00Z`) - Date.parse(`${requestStartDate}T00:00:00Z`)) / 86400000))
      : 0
    const maxBorrowDays = Number(detail?.max_days || 7)
    if (requestedDays > maxBorrowDays) {
      formErrors.return_date = `This item can be borrowed for up to ${maxBorrowDays} days.`
    }
    setRequestFieldErrors(formErrors)
    if (Object.keys(formErrors).length) {
      form.querySelector(`[name="${Object.keys(formErrors)[0]}"]`)?.focus()
      return
    }
    requestSubmitting.current = true
    setRequestMessage('')
    setRequestBusy(true)
    const values = Object.fromEntries(new FormData(form))
    try {
      const result = await apiRequest('/requests', {
        token,
        method: 'POST',
        body: JSON.stringify({
          item_id: selectedItem.id,
          start_date: values.start_date,
          return_date: values.return_date,
          purpose: values.purpose,
        }),
      })
      const successMessage = `Request sent. Your request number is ${result.request.id}.`
      setRequestMessage(successMessage)
      pushToast('success', 'Borrow request sent.')
      setRetry((value) => value + 1)
    } catch (requestError) {
      const message = requestError.message
      setRequestMessage(message)
      if (!requestError.sessionExpired) pushToast('error', message)
    } finally {
      requestSubmitting.current = false
      setRequestBusy(false)
    }
  }

  async function handleListingSubmit(event) {
    event.preventDefault()
    if (listingSubmitting.current) return
    const form = event.currentTarget
    const formErrors = validateForm(form)
    setListingFieldErrors(formErrors)
    if (Object.keys(formErrors).length) {
      form.querySelector(`[name="${Object.keys(formErrors)[0]}"]`)?.focus()
      return
    }
    listingSubmitting.current = true
    setListingError('')
    setListingBusy(true)
    const values = Object.fromEntries(new FormData(form))
    try {
      const imageUrls = listingInitial || listingFiles.length === 0
        ? []
        : await uploadImages(listingFiles.map(({ file }) => file), token)
      await apiRequest(listingInitial ? `/items/${listingInitial.id}` : '/items', {
        token,
        method: listingInitial ? 'PUT' : 'POST',
        body: JSON.stringify({
          title: values.title,
          description: values.description,
          category_id: values.category_id,
          item_condition: values.item_condition,
          location: values.location,
          deposit_amount: Number(values.deposit_amount || 0),
          max_days: Number(values.max_days || 7),
          ...(listingInitial ? { is_available: values.is_available === 'true' } : {}),
          ...(listingInitial ? {} : { image_urls: imageUrls }),
        }),
      })
      pushToast('success', listingInitial ? 'Listing saved.' : 'Listing published.')
      setShowListingForm(false)
      setListingInitial(null)
      clearListingFiles()
      setListingFileError('')
      setActiveView('account')
      setRetry((value) => value + 1)
    } catch (listingRequestError) {
      const message = listingRequestError.message
      setListingError(message)
      if (!listingRequestError.sessionExpired) pushToast('error', message)
    } finally {
      listingSubmitting.current = false
      setListingBusy(false)
    }
  }

  async function handleEditListing(listing) {
    setListingError('')
    setListingFieldErrors({})
    clearListingFiles()
    setListingFileError('')
    setListingBusy(true)
    try {
      const { item } = await apiRequest(`/items/${listing.id}`)
      setListingInitial(item)
      setShowListingForm(true)
    } catch (editError) {
      if (!editError.sessionExpired) setDashboardError(editError.message)
    } finally {
      setListingBusy(false)
    }
  }

  function openListingForm() {
    setListingInitial(null)
    setListingError('')
    setListingFieldErrors({})
    clearListingFiles()
    setListingFileError('')
    setShowListingForm(true)
  }

  function clearListingFiles() {
    listingFiles.forEach(({ previewUrl }) => {
      URL.revokeObjectURL(previewUrl)
      listingPreviewUrlsRef.current.delete(previewUrl)
    })
    setListingFiles([])
  }

  function handleListingFilesChange(event) {
    const selectedFiles = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    const errors = []
    const validFiles = selectedFiles.filter((file) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        errors.push(`${file.name}: choose a JPG, PNG, or WebP image.`)
        return false
      }
      if (file.size > 5 * 1024 * 1024) {
        errors.push(`${file.name}: images must be 5 MB or smaller.`)
        return false
      }
      return true
    })
    const remainingSlots = Math.max(0, 5 - listingFiles.length)
    if (validFiles.length > remainingSlots) {
      errors.push('You can upload up to 5 photos.')
    }
    const filesToAdd = validFiles.slice(0, remainingSlots).map((file) => {
      const previewUrl = URL.createObjectURL(file)
      listingPreviewUrlsRef.current.add(previewUrl)
      return { file, previewUrl }
    })
    setListingFiles((currentFiles) => [...currentFiles, ...filesToAdd])
    setListingFileError(errors.join(' '))
  }

  async function handleDeleteListing(listing) {
    setConfirmation({
      title: 'Delete this listing?',
      message: `“${listing.title}” will be permanently removed.`,
      confirmLabel: 'Delete listing',
      onConfirm: async () => {
        setPendingAction(`delete-${listing.id}`)
        setDashboardError('')
        try {
          await apiRequest(`/items/${listing.id}`, { token, method: 'DELETE' })
          pushToast('success', 'Listing deleted.')
          setRetry((value) => value + 1)
        } catch (deleteError) {
          if (!deleteError.sessionExpired) {
            setDashboardError(deleteError.message)
            pushToast('error', deleteError.message)
          }
        } finally {
          setPendingAction('')
        }
      },
    })
  }

  async function handleReviewSubmit(requestId, event) {
    event.preventDefault()
    if (reviewSubmitting.current) return
    const form = event.currentTarget
    const formErrors = validateForm(form)
    setReviewFieldErrors(formErrors)
    if (Object.keys(formErrors).length) {
      form.querySelector(`[name="${Object.keys(formErrors)[0]}"]`)?.focus()
      return
    }
    reviewSubmitting.current = true
    setReviewMessage('')
    setReviewBusy(true)
    const values = Object.fromEntries(new FormData(form))
    try {
      await apiRequest('/reviews', {
        token,
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId,
          rating: Number(values.rating),
          comment: values.comment,
        }),
      })
      const message = 'Review submitted. Thank you for sharing your experience.'
      setReviewMessage(message)
      pushToast('success', 'Review posted.')
      setReviewingRequestId(null)
      setRetry((value) => value + 1)
    } catch (reviewError) {
      const message = reviewError.message
      setReviewMessage(message)
      if (!reviewError.sessionExpired) pushToast('error', message)
    } finally {
      reviewSubmitting.current = false
      setReviewBusy(false)
    }
  }

  function closeProfile() {
    setShowProfile(false)
    setProfile(null)
    setProfileError('')
    setProfileItems([])
    if (window.location.pathname.startsWith('/profile/')) {
      window.history.pushState({}, '', '/')
    }
  }

  async function openProfile(userId) {
    setProfile(null)
    setProfileError('')
    setProfileItems([])
    setShowProfile(true)
    if (window.location.pathname !== `/profile/${userId}`) {
      window.history.pushState({}, '', `/profile/${userId}`)
    }
    try {
      const [profileData, itemsData] = await Promise.all([
        apiRequest(`/reviews/user/${userId}`),
        apiRequest('/items'),
      ])
      const matches = (itemsData.items || []).filter((entry) => {
        const ownerMatch = entry.owner_id != null && String(entry.owner_id) === String(userId)
        const nameMatch = entry.owner_name && profileData.user && entry.owner_name === profileData.user.name
        return ownerMatch || nameMatch
      })

      setProfile(profileData)
      setProfileItems(matches)
    } catch (profileRequestError) {
      setProfileError(profileRequestError.message)
    }
  }

  async function markNotificationRead(notification) {
    try {
      await apiRequest(`/notifications/${notification.id}/read`, { token, method: 'PUT' })
      setNotifications((current) => current.map((entry) => entry.id === notification.id ? { ...entry, is_read: true } : entry))
      setUnreadCount((count) => Math.max(0, count - (notification.is_read ? 0 : 1)))
      if (notification.request_id) {
        setNotificationsOpen(false)
        setDashboardError('')
        setActiveView('account')
      }
    } catch (notificationRequestError) {
      if (!notificationRequestError.sessionExpired) setNotificationError(notificationRequestError.message)
    }
  }

  async function markAllNotificationsRead() {
    try {
      await apiRequest('/notifications/read-all', { token, method: 'PUT' })
      setNotifications((current) => current.map((entry) => ({ ...entry, is_read: true })))
      setUnreadCount(0)
      pushToast('success', 'All notifications marked as read.')
    } catch (notificationRequestError) {
      if (!notificationRequestError.sessionExpired) {
        setNotificationError(notificationRequestError.message)
        pushToast('error', notificationRequestError.message)
      }
    }
  }

  function handleRequestAction(requestId, action) {
    if (action === 'cancel') {
      setConfirmation({
        title: 'Cancel this request?',
        message: 'The owner will no longer be able to approve this borrow request.',
        confirmLabel: 'Cancel request',
        onConfirm: () => runRequestAction(requestId, action),
      })
      return
    }
    return runRequestAction(requestId, action)
  }

  async function runRequestAction(requestId, action) {
    const actionKey = `${requestId}-${action}`
    setPendingAction(actionKey)
    setDashboardError('')
    try {
      await apiRequest(`/requests/${requestId}/${action}`, { token, method: 'PUT' })
      pushToast('success', 'Request updated.')
      setRetry((value) => value + 1)
    } catch (actionError) {
      if (!actionError.sessionExpired) {
        setDashboardError(actionError.message)
        pushToast('error', actionError.message)
      }
    } finally {
      setPendingAction('')
    }
  }

  async function toggleAvailability(item) {
    setPendingAction(`item-${item.id}`)
    setDashboardError('')
    try {
      await apiRequest(`/items/${item.id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ is_available: !item.is_available }),
      })
      pushToast('success', item.is_available ? 'Listing paused.' : 'Listing made available.')
      setRetry((value) => value + 1)
    } catch (updateError) {
      if (!updateError.sessionExpired) {
        setDashboardError(updateError.message)
        pushToast('error', updateError.message)
      }
    } finally {
      setPendingAction('')
    }
  }

  function closeDetails() {
    setGalleryIndex(0)
    setLightboxOpen(false)
    setSelectedItem(null)
    setItemDetail(null)
    setRequestMessage('')
    setRequestStartDate('')
    setRequestReturnDate('')
    setRequestFieldErrors({})
  }

  function openItem(item) {
    setGalleryIndex(0)
    setLightboxOpen(false)
    setItemDetail(null)
    setDetailError('')
    setRequestMessage('')
    setRequestStartDate('')
    setRequestReturnDate('')
    setRequestFieldErrors({})
    setSelectedItem(item)
  }

  function closeListingForm() {
    setShowListingForm(false)
    setListingInitial(null)
    setListingFieldErrors({})
    clearListingFiles()
    setListingFileError('')
  }

  function closeLightbox() {
    setLightboxOpen(false)
  }

  function openLightbox(index) {
    setGalleryIndex(index)
    setLightboxOpen(true)
  }

  async function handleShare() {
    if (!detail) return
    const shareUrl = `${window.location.origin}/?item=${detail.id}`
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = shareUrl
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(`${detail.title} on BorrowBox: ${shareUrl}`)}`
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer')
      pushToast('success', 'Share link copied to your clipboard.')
    } catch {
      pushToast('error', 'Could not copy the share link. Please try again.')
    }
  }

  function renderRequestRow(request, perspective) {
    const isOwner = perspective === 'owner'
    const actions = isOwner
      ? request.status === 'requested' ? ['approve', 'reject']
        : request.status === 'approved' ? ['handover']
          : request.status === 'returned' ? ['complete'] : []
      : request.status === 'requested' ? ['cancel']
        : request.status === 'active' ? ['return'] : []
    const actionLabels = {
      approve: 'Approve', reject: 'Decline', handover: 'Mark handed over',
      complete: 'Confirm return', cancel: 'Cancel request', return: 'Mark returned',
    }

    return (
      <article className="request-row" key={`${perspective}-${request.id}`}>
        <div className="request-summary">
          <strong>{request.item_title}</strong>
          <span>{isOwner ? `Requested by ${request.borrower_name}` : `Owner: ${request.owner_name}`}</span>
          <span>{request.start_date} to {request.return_date}</span>
        </div>
        <div className="request-controls">
          <span className={`status-badge status-${request.status}`}>{request.status}</span>
          {actions.map((action) => {
            const actionKey = `${request.id}-${action}`
            return (
              <button
                className={action === 'reject' || action === 'cancel' ? 'quiet-button' : 'small-button'}
                disabled={pendingAction === actionKey}
                key={action}
                onClick={() => handleRequestAction(request.id, action)}
                type="button"
              >
                {actionLabels[action]}
              </button>
            )
          })}
          {request.status === 'completed' && (
            <button
              className="small-button"
              onClick={() => { setReviewMessage(''); setReviewFieldErrors({}); setReviewingRequestId(String(request.id)) }}
              type="button"
            >
              Leave review
            </button>
          )}
        </div>
        {reviewingRequestId === String(request.id) && (
          <form className="review-form" noValidate onChange={(event) => updateFieldErrors(setReviewFieldErrors, event)} onSubmit={(event) => handleReviewSubmit(request.id, event)}>
            <label htmlFor={`review-rating-${request.id}`}>Rating
              <select aria-describedby={reviewFieldErrors.rating ? `review-rating-error-${request.id}` : undefined} aria-invalid={Boolean(reviewFieldErrors.rating)} id={`review-rating-${request.id}`} name="rating" autoComplete="off" defaultValue="5" required>
                <option value="5">5 stars</option><option value="4">4 stars</option>
                <option value="3">3 stars</option><option value="2">2 stars</option>
                <option value="1">1 star</option>
              </select>
              <FieldError id={`review-rating-error-${request.id}`} message={reviewFieldErrors.rating} />
            </label>
            <label htmlFor={`review-comment-${request.id}`}>Comment (optional)<textarea aria-describedby={reviewFieldErrors.comment ? `review-comment-error-${request.id}` : undefined} aria-invalid={Boolean(reviewFieldErrors.comment)} id={`review-comment-${request.id}`} name="comment" rows="2" maxLength="500" autoComplete="off" /><FieldError id={`review-comment-error-${request.id}`} message={reviewFieldErrors.comment} /></label>
            {reviewMessage && <p className="form-note" role="status">{reviewMessage}</p>}
            <div className="review-actions">
              <button className="small-button" disabled={reviewBusy} type="submit">{reviewBusy ? 'Submitting...' : 'Submit review'}</button>
              <button className="quiet-button" onClick={() => setReviewingRequestId(null)} type="button">Cancel</button>
            </div>
          </form>
        )}
      </article>
    )
  }

  const detail = itemDetail || selectedItem
  const isOwnItem = itemDetail && user && Number(itemDetail.owner_id) === Number(user.id)
  const requestDateDifference = requestStartDate && requestReturnDate
    ? Math.round((Date.parse(`${requestReturnDate}T00:00:00Z`) - Date.parse(`${requestStartDate}T00:00:00Z`)) / 86400000)
    : null
  const requestDayCount = requestDateDifference === null || requestDateDifference < 0
    ? null
    : Math.max(1, requestDateDifference)
  const galleryImages = detail && (detail.images && detail.images.length ? detail.images : detail.image_url ? [detail.image_url] : [])
  const sortedItems = [...items].sort((first, second) => {
    if (sortBy === 'distance') {
      const firstDistance = nearbyDistances[first.id]
      const secondDistance = nearbyDistances[second.id]
      if (firstDistance === undefined && secondDistance !== undefined) return 1
      if (secondDistance === undefined && firstDistance !== undefined) return -1
      if (firstDistance !== undefined && secondDistance !== undefined) return firstDistance - secondDistance
    }
    if (sortBy === 'deposit-low') return Number(first.deposit_amount || 0) - Number(second.deposit_amount || 0)
    if (sortBy === 'deposit-high') return Number(second.deposit_amount || 0) - Number(first.deposit_amount || 0)
    return Number(second.id || 0) - Number(first.id || 0)
  })
  const isKnownRoute = window.location.pathname === '/' || /^\/profile\/\d+\/?$/.test(window.location.pathname)

  return (
    <div className="app-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" onClick={() => setActiveView('browse')} aria-label="BorrowBox home">
          <span className="brand-mark" aria-hidden="true">b</span><span>borrowbox</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={activeView === 'browse' ? 'nav-active' : ''} onClick={() => setActiveView('browse')} type="button">Explore</button>
          {user && <button className={activeView === 'account' ? 'nav-active' : ''} onClick={() => { setDashboardError(''); setActiveView('account') }} type="button">My account</button>}
        </nav>
        <button
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          type="button"
        >
          <span /><span /><span />
        </button>
        {mobileMenuOpen && (
          <nav className="mobile-menu" aria-label="Mobile navigation">
            <button className={activeView === 'browse' ? 'nav-active' : ''} onClick={() => { setActiveView('browse'); setMobileMenuOpen(false) }} type="button">Explore</button>
            {user && <button className={activeView === 'account' ? 'nav-active' : ''} onClick={() => { setDashboardError(''); setActiveView('account'); setMobileMenuOpen(false) }} type="button">My account</button>}
            <button onClick={() => { if (user) openListingForm(); else openAuth('login'); setMobileMenuOpen(false) }} type="button">List an item</button>
            {user ? (
              <>
                <button onClick={() => { setNotificationError(''); setNotificationsOpen((open) => !open) }} type="button">
                  Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
                </button>
                {notificationsOpen && (
                  <section className="mobile-notification-menu" aria-label="Notifications">
                    <div className="notification-heading"><strong>Notifications</strong><button onClick={markAllNotificationsRead} type="button">Mark all read</button></div>
                    {notificationError && <p className="form-error">{notificationError}</p>}
                    {notifications.length === 0 ? <p className="notification-empty">No notifications yet.</p> : notifications.map((notification) => (
                      <button className={`notification-row ${notification.is_read ? '' : 'notification-unread'}`} key={`mobile-${notification.id}`} onClick={() => markNotificationRead(notification)} type="button">
                        <span>{notification.message}</span>
                        <small>{new Date(notification.created_at).toLocaleString()}</small>
                      </button>
                    ))}
                  </section>
                )}
                <button onClick={requestLogoutConfirmation} type="button">Sign out</button>
              </>
            ) : (
              <button onClick={() => { openAuth('login'); setMobileMenuOpen(false) }} type="button">Sign in</button>
            )}
          </nav>
        )}
        <div className="top-actions">
          <button className="list-button" onClick={() => user ? openListingForm() : openAuth('login')} type="button">List an item <span aria-hidden="true">+</span></button>
          {user && (
            <div className="notification-area">
              <button
                aria-expanded={notificationsOpen}
                aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                className="notification-button"
                onClick={() => { setNotificationError(''); setNotificationsOpen((open) => !open) }}
                type="button"
              >
                Notifications{unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
              </button>
              {notificationsOpen && (
                <section className="notification-menu" aria-label="Notifications">
                  <div className="notification-heading"><strong>Notifications</strong><button onClick={markAllNotificationsRead} type="button">Mark all read</button></div>
                  {notificationError && <p className="form-error">{notificationError}</p>}
                  {notifications.length === 0 ? <p className="notification-empty">No notifications yet.</p> : notifications.map((notification) => (
                    <button className={`notification-row ${notification.is_read ? '' : 'notification-unread'}`} key={notification.id} onClick={() => markNotificationRead(notification)} type="button">
                      <span>{notification.message}</span>
                      <small>{new Date(notification.created_at).toLocaleString()}</small>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
          {user
            ? <button className="account-button" onClick={requestLogoutConfirmation} type="button">Sign out</button>
            : <button className="account-button" onClick={() => openAuth('login')} type="button">Sign in</button>}
        </div>
      </header>

      <main>
        {!isKnownRoute ? (
          <section className="not-found-page" aria-labelledby="not-found-title">
            <p className="eyebrow">404 · PAGE NOT FOUND</p>
            <h1 id="not-found-title">Looks like this item isn’t on our shelf.</h1>
            <p>That page may have moved, or the link may be incorrect. Let’s get you back to the neighborhood shelf.</p>
            <a className="primary-button" href="/">Back to BorrowBox</a>
          </section>
        ) : activeView === 'browse' ? (
          <>
            <section className="intro" aria-labelledby="page-title">
              <div className="intro-copy">
                <p className="eyebrow"><span className="eyebrow-dot" /> A LITTLE LESS BUYING. A LOT MORE SHARING.</p>
                <h1 id="page-title">Good things are<br />closer than you think.</h1>
                <p className="intro-note">Find useful things nearby, shared by people in your community.</p>
              </div>
              <div className="intro-art" aria-hidden="true">
                <span className="art-circle circle-one" /><span className="art-circle circle-two" />
                <span className="art-box"><i /><i /><i /></span><span className="art-caption">borrow<br />more</span>
              </div>
              <div className="search-panel">
                <label className="search-field">
                  <span className="field-label">What are you looking for?</span>
                  <span className="input-wrap"><span aria-hidden="true">⌕</span><input type="search" autoComplete="off" value={search} onChange={(event) => { resetNearbyResults(); setLoading(true); setError(''); setSearch(event.target.value) }} placeholder="Camera, drill, tent..." /></span>
                </label>
                <label className="search-field location-field">
                  <span className="field-label">Where?</span>
                  <span className="input-wrap"><span aria-hidden="true">⌖</span><input type="text" autoComplete="address-level2" value={location} onChange={(event) => { resetNearbyResults(); setLoading(true); setError(''); setLocation(event.target.value) }} placeholder="City or neighborhood" /></span>
                </label>
                <a className="search-button" href="#listings">Find an item <span aria-hidden="true">→</span></a>
              </div>
            </section>

            <section className="marketplace" id="listings" aria-labelledby="listings-title">
              <div className="section-heading">
                <div><p className="eyebrow section-eyebrow">THE NEIGHBORHOOD SHELF</p><h2 id="listings-title">Things to borrow</h2></div>
                <div className="listing-controls">
                  <label className="category-select-label">
                    <span>Category</span>
                    <select value={category} onChange={(event) => { resetNearbyResults(); setLoading(true); setError(''); setCategory(event.target.value) }}>
                      <option value="">All categories</option>
                      {categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                    </select>
                  </label>
                  <label className="category-select-label sort-select-label">
                    <span>Sort</span>
                    <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                      <option value="newest">Newest</option>
                      <option value="deposit-low">Deposit low to high</option>
                      <option value="deposit-high">Deposit high to low</option>
                      <option value="distance" disabled={Object.keys(nearbyDistances).length === 0}>Nearest first</option>
                    </select>
                  </label>
                  <button className="nearby-button" type="button" onClick={findNearbyItems} disabled={nearbyBusy}>
                    {nearbyBusy ? 'Finding nearby…' : 'Find nearby'}
                  </button>
                </div>
              </div>
              {nearbyMessage && <p className="nearby-message" role="status">{nearbyMessage}</p>}
              {nearbyError && <p className="nearby-error" role="alert">{nearbyError}</p>}
              {error ? (
                <div className="status-panel error-panel" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(''); setLoading(true); setRetry((value) => value + 1) }}>Try again</button></div>
              ) : loading ? (
                <div className="item-grid skeleton-grid" aria-live="polite" aria-label="Loading items">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div className="skeleton-card" key={`skeleton-${index}`}>
                      <div className="skeleton-image" />
                      <div className="skeleton-body">
                        <div className="skeleton-line short" />
                        <div className="skeleton-line" />
                        <div className="skeleton-line medium" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="status-panel empty-panel">
                  <h3>No items yet</h3>
                  <p>Try another search or be the first to share something useful in your area.</p>
                  <button className="primary-button" onClick={openListingForm} type="button">List an item</button>
                </div>
              ) : (
                <div className="item-grid">
                  {sortedItems.map((item, index) => (
                    <button className="item-card" key={item.id} onClick={() => openItem(item)} type="button">
                      <span className={`item-image image-tone-${index % 4}`}>
                        {item.image_url ? <img src={item.image_url} alt={item.title} loading="lazy" /> : <span className="image-placeholder" aria-hidden="true">{item.category?.slice(0, 1) || 'B'}</span>}
                        <span className="category-tag">{item.category}</span>
                      </span>
                      <span className="item-info">
                        <span className="item-title-line"><strong>{item.title}</strong><span className="condition">{item.item_condition || 'Good'}</span></span>
                        <span className="item-location"><span aria-hidden="true">⌖</span> {item.location || 'Location shared after request'}{nearbyDistances[item.id] !== undefined && <span className="item-distance">{formatDistance(nearbyDistances[item.id])}</span>}</span>
                        <span className="item-footer"><span><strong>${Number(item.deposit_amount || 0).toFixed(0)}</strong> deposit</span><span>Up to {item.max_days || 7} days</span></span>
                        <span className="owner-line">Shared by <strong>{item.owner_name}</strong>{item.owner_trust ? <span className="trust-score"> · {Number(item.owner_trust).toFixed(1)} ★</span> : null}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            <section className="about-strip" id="about">
              <span className="about-index">01 / SHARE LOCALLY</span>
              <p>Borrow what you need.<br /><strong>Pass the good stuff on.</strong></p>
              <a href="#listings">Explore the shelf <span aria-hidden="true">↗</span></a>
            </section>
          </>
        ) : (
          <section className="dashboard-view">
            <div className="dashboard-heading">
              <div><p className="eyebrow">YOUR BORROWBOX</p><h1>Hi, {user?.name}</h1></div>
              <button className="primary-button" onClick={openListingForm} type="button">Add a listing <span aria-hidden="true">+</span></button>
            </div>
            {dashboardError && <p className="dashboard-error" role="alert">{dashboardError}</p>}
            {reviewMessage && <p className="form-note review-success" role="status">{reviewMessage}</p>}

            {dashboardLoading ? (
              <div className="dashboard-skeleton" aria-live="polite" aria-label="Loading dashboard">
                <div className="dashboard-skeleton-block large" />
                <div className="dashboard-skeleton-block medium" />
                <div className="dashboard-skeleton-block" />
              </div>
            ) : (
              <>
                <section className="dashboard-section">
                  <div className="dashboard-section-heading"><h2>Your listings</h2><span>{dashboard.listings.length} items</span></div>
                  {dashboard.listings.length === 0 ? (
                    <div className="status-panel empty-panel compact-empty">
                      <h3>No items yet</h3>
                      <p>Share something you already own and help your neighbors borrow it instead.</p>
                      <button className="primary-button" onClick={openListingForm} type="button">List your first item</button>
                    </div>
                  ) : dashboard.listings.map((item) => (
                    <article className="listing-row" key={item.id}>
                      <div><strong>{item.title}</strong><span>{item.category}</span></div>
                      <span className={`availability ${item.is_available ? 'available' : 'unavailable'}`}>{item.is_available ? 'Available' : 'Paused'}</span>
                      <button className="small-button" disabled={listingBusy} onClick={() => handleEditListing(item)} type="button">Edit</button>
                      <button className="small-button" disabled={pendingAction === `item-${item.id}`} onClick={() => toggleAvailability(item)} type="button">{item.is_available ? 'Pause listing' : 'Make available'}</button>
                      <button className="quiet-button" disabled={pendingAction === `delete-${item.id}`} onClick={() => handleDeleteListing(item)} type="button">Delete</button>
                    </article>
                  ))}
                </section>

                <section className="dashboard-section">
                  <div className="dashboard-section-heading"><h2>Requests for your items</h2><span>{dashboard.incoming.length} requests</span></div>
                  {dashboard.incoming.length === 0 ? (
                    <div className="status-panel empty-panel compact-empty">
                      <h3>No requests yet</h3>
                      <p>When someone wants to borrow your items, they will show up here.</p>
                      <button className="primary-button" onClick={() => setActiveView('browse')} type="button">Browse listings</button>
                    </div>
                  ) : dashboard.incoming.map((request) => renderRequestRow(request, 'owner'))}
                </section>

                <section className="dashboard-section">
                  <div className="dashboard-section-heading"><h2>Your borrow requests</h2><span>{dashboard.mine.length} requests</span></div>
                  {dashboard.mine.length === 0 ? (
                    <div className="status-panel empty-panel compact-empty">
                      <h3>No requests yet</h3>
                      <p>Start exploring the neighborhood shelf and send a request to borrow something you need.</p>
                      <button className="primary-button" onClick={() => setActiveView('browse')} type="button">Explore items</button>
                    </div>
                  ) : dashboard.mine.map((request) => renderRequestRow(request, 'borrower'))}
                </section>
              </>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        <a className="brand" href="#top" onClick={() => setActiveView('browse')}><span className="brand-mark" aria-hidden="true">b</span><span>borrowbox</span></a>
        <div className="footer-links">
          <button className="footer-link" onClick={() => setInfoPage('how-it-works')} type="button">How it works</button>
          <button className="footer-link" onClick={() => setInfoPage('faq')} type="button">FAQ</button>
          <button className="footer-link" onClick={() => setInfoPage('about')} type="button">About</button>
          <button className="footer-link" onClick={() => setInfoPage('terms')} type="button">Terms</button>
          <button className="footer-link" onClick={() => setInfoPage('privacy')} type="button">Privacy</button>
        </div>
        <span>Good things, shared locally.</span>
      </footer>

      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div className={`toast toast-${toast.type}`} key={toast.id}>{toast.message}</div>
          ))}
        </div>
      )}

      {authMode && (
        <div className="modal-backdrop auth-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAuth() }}>
          <section className="form-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex="-1">
            <button className="modal-close" onClick={closeAuth} type="button" aria-label="Close">×</button>
            <p className="eyebrow">WELCOME TO BORROWBOX</p>
            <h2 id="auth-title">{authMode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
            <form className="stacked-form" noValidate onChange={(event) => updateFieldErrors(setAuthFieldErrors, event)} onSubmit={handleAuthSubmit}>
              {authMode === 'register' && (
                <div className="form-field">
                  <label htmlFor="auth-name">Your name</label>
                  <input aria-describedby={authFieldErrors.name ? 'auth-name-error' : undefined} aria-invalid={Boolean(authFieldErrors.name)} id="auth-name" name="name" type="text" autoComplete="name" required />
                  <FieldError id="auth-name-error" message={authFieldErrors.name} />
                </div>
              )}
              <div className="form-field">
                <label htmlFor="auth-email">Email</label>
                <input aria-describedby={authFieldErrors.email ? 'auth-email-error' : undefined} aria-invalid={Boolean(authFieldErrors.email)} id="auth-email" name="email" type="email" autoComplete="email" required />
                <FieldError id="auth-email-error" message={authFieldErrors.email} />
              </div>
              {authMode === 'register' && (
                <div className="form-field">
                  <label htmlFor="auth-phone">Phone (optional)</label>
                  <input id="auth-phone" name="phone" type="tel" autoComplete="tel" />
                </div>
              )}
              {authMode === 'register' && (
                <div className="form-field">
                  <label htmlFor="auth-location">Location (optional)</label>
                  <input id="auth-location" name="location" type="text" autoComplete="address-level2" />
                </div>
              )}
              <div className="form-field">
                <label htmlFor="auth-password">Password</label>
                <div className="password-input">
                  <input aria-describedby={authFieldErrors.password ? 'auth-password-error' : undefined} aria-invalid={Boolean(authFieldErrors.password)} id="auth-password" name="password" type={passwordVisible ? 'text' : 'password'} minLength="8" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required />
                  <button className="password-toggle" aria-controls="auth-password" aria-label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible((visible) => !visible)} type="button">{passwordVisible ? 'Hide' : 'Show'}</button>
                </div>
                <FieldError id="auth-password-error" message={authFieldErrors.password} />
              </div>
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="primary-button form-submit" disabled={authBusy} type="submit">{authBusy ? 'Please wait...' : authMode === 'register' ? 'Create account' : 'Sign in'}</button>
            </form>
            <p className="form-switch">{authMode === 'register' ? 'Already a member?' : 'New to BorrowBox?'} <button onClick={() => { setAuthError(''); setAuthFieldErrors({}); setPasswordVisible(false); setAuthMode(authMode === 'register' ? 'login' : 'register') }} type="button">{authMode === 'register' ? 'Sign in' : 'Create an account'}</button></p>
          </section>
        </div>
      )}

      {selectedItem && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails() }}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabIndex="-1">
            <button className="modal-close" onClick={closeDetails} type="button" aria-label="Close">×</button>
            {detailError && <p className="form-error" role="alert">{detailError}</p>}
            {!detail && !detailError ? <div className="status-panel" role="status"><span className="loader" /> Loading item details...</div> : detail && <div className="detail-layout">
              <div className="detail-photo">
                {galleryImages.length > 0 ? (
                  <>
                    <button className="gallery-main-button" onClick={() => openLightbox(galleryIndex)} type="button" aria-label={`View photo ${galleryIndex + 1} of ${galleryImages.length}`}>
                      <img src={galleryImages[galleryIndex]} alt={detail.title} />
                    </button>
                    {galleryImages.length > 1 && (
                      <div className="detail-thumbs" aria-label="Gallery thumbnails">
                        {galleryImages.map((image, index) => (
                          <button className={index === galleryIndex ? 'detail-thumb active' : 'detail-thumb'} key={`${detail.id}-thumb-${index}`} onClick={() => setGalleryIndex(index)} type="button" aria-label={`Show image ${index + 1}`}>
                            <img src={image} alt="" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : <span aria-hidden="true">{detail.category?.slice(0, 1) || 'B'}</span>}
              </div>
              <div className="detail-content">
                <p className="eyebrow">{detail.category}</p>
                <h2 id="detail-title">{detail.title}</h2>
                <p className="detail-description">{detail.description || 'The owner has not added a description yet.'}</p>
                <div className="detail-actions">
                  <button className="small-button" onClick={handleShare} type="button">Share</button>
                </div>
                <dl className="detail-facts">
                  <div><dt>Condition</dt><dd>{detail.item_condition || 'Good'}</dd></div>
                  <div><dt>Location</dt><dd>{detail.location || 'Shared after request'}</dd></div>
                  <div><dt>Deposit</dt><dd>${Number(detail.deposit_amount || 0).toFixed(2)}</dd></div>
                  <div><dt>Maximum borrow</dt><dd>{detail.max_days || 7} days</dd></div>
                  <div><dt>Owner</dt><dd><button className="profile-link" onClick={() => openProfile(detail.owner_id)} type="button">{detail.owner_name}{detail.owner_trust ? ` · ${Number(detail.owner_trust).toFixed(1)} rating` : ''}</button></dd></div>
                </dl>
                {isOwnItem ? <p className="form-note">This is your listing.</p> : !user ? (
                  <button className="primary-button form-submit" onClick={() => openAuth('login')} type="button">Sign in to request</button>
                ) : (
                  <form className="stacked-form request-form" noValidate onChange={(event) => updateFieldErrors(setRequestFieldErrors, event)} onSubmit={handleBorrowSubmit}>
                    <h3>Request to borrow</h3>
                    <p className="request-item-details">
                      Borrow for up to <strong>{detail.max_days || 7} days</strong>; deposit <strong>${Number(detail.deposit_amount || 0).toFixed(2)}</strong>.
                    </p>
                    <p className="request-duration" aria-live="polite">
                      {requestDayCount === null ? 'Choose dates to see the borrow duration.' : `${requestDayCount} ${requestDayCount === 1 ? 'day' : 'days'}`}
                    </p>
                    <div className="date-fields">
                      <div className="form-field">
                        <label htmlFor="request-start-date">Start date</label>
                        <input aria-describedby={requestFieldErrors.start_date ? 'request-start-date-error' : undefined} aria-invalid={Boolean(requestFieldErrors.start_date)} id="request-start-date" name="start_date" type="date" min={today} autoComplete="off" required value={requestStartDate} onChange={handleRequestDateChange} />
                        <FieldError id="request-start-date-error" message={requestFieldErrors.start_date} />
                      </div>
                      <div className="form-field">
                        <label htmlFor="request-return-date">Return date</label>
                        <input aria-describedby={requestFieldErrors.return_date ? 'request-return-date-error' : undefined} aria-invalid={Boolean(requestFieldErrors.return_date)} id="request-return-date" name="return_date" type="date" min={requestStartDate || today} autoComplete="off" required value={requestReturnDate} onChange={(event) => handleRequestDateChange(event)} />
                        <FieldError id="request-return-date-error" message={requestFieldErrors.return_date} />
                      </div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="request-purpose">Purpose (optional)</label>
                      <textarea id="request-purpose" name="purpose" rows="2" maxLength="500" autoComplete="off" />
                      <FieldError id="request-purpose-error" message={requestFieldErrors.purpose} />
                    </div>
                    {requestMessage && <p className="form-note" role="status">{requestMessage}</p>}
                    <button className="primary-button form-submit" disabled={requestBusy} type="submit">{requestBusy ? 'Sending...' : 'Send borrow request'}</button>
                  </form>
                )}
              </div>
            </div>}
          </section>
        </div>
      )}

      {lightboxOpen && galleryImages.length > 0 && (
        <div className="modal-backdrop lightbox-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeLightbox() }}>
          <section className="lightbox" role="dialog" aria-modal="true" aria-label="Item gallery" tabIndex="-1">
            <button className="modal-close lightbox-close" onClick={closeLightbox} type="button" aria-label="Close">×</button>
            <button className="lightbox-nav lightbox-prev" onClick={() => setGalleryIndex((current) => (current === 0 ? galleryImages.length - 1 : current - 1))} type="button" aria-label="Previous image">‹</button>
            <img src={galleryImages[galleryIndex]} alt={detail.title} />
            <button className="lightbox-nav lightbox-next" onClick={() => setGalleryIndex((current) => (current === galleryImages.length - 1 ? 0 : current + 1))} type="button" aria-label="Next image">›</button>
          </section>
        </div>
      )}

      {showListingForm && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeListingForm() }}>
          <section className="form-modal listing-modal" role="dialog" aria-modal="true" aria-labelledby="listing-title" tabIndex="-1">
            <button className="modal-close" onClick={closeListingForm} type="button" aria-label="Close">×</button>
            <p className="eyebrow">SHARE WITH YOUR COMMUNITY</p>
            <h2 id="listing-title">{listingInitial ? 'Edit listing' : 'List an item'}</h2>
            <form className="stacked-form" noValidate onChange={(event) => updateFieldErrors(setListingFieldErrors, event)} onSubmit={handleListingSubmit}>
              <div className="form-field">
                <label htmlFor="listing-title-input">Item name</label>
                <input aria-describedby={listingFieldErrors.title ? 'listing-title-error' : undefined} aria-invalid={Boolean(listingFieldErrors.title)} id="listing-title-input" name="title" type="text" maxLength="160" defaultValue={listingInitial?.title || ''} autoComplete="off" required />
                <FieldError id="listing-title-error" message={listingFieldErrors.title} />
              </div>
              <div className="form-field">
                <label htmlFor="listing-category">Category</label>
                <select aria-describedby={listingFieldErrors.category_id ? 'listing-category-error' : undefined} aria-invalid={Boolean(listingFieldErrors.category_id)} id="listing-category" name="category_id" required defaultValue={listingInitial?.category_id || ''} autoComplete="off"><option value="" disabled>Choose a category</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
                <FieldError id="listing-category-error" message={listingFieldErrors.category_id} />
              </div>
              <div className="form-field">
                <label htmlFor="listing-description">Description</label>
                <textarea id="listing-description" name="description" rows="3" maxLength="2000" defaultValue={listingInitial?.description || ''} autoComplete="off" />
              </div>
              <div className="date-fields">
                <div className="form-field">
                  <label htmlFor="listing-condition">Condition</label>
                  <select id="listing-condition" name="item_condition" defaultValue={listingInitial?.item_condition || 'Good'} autoComplete="off"><option>New</option><option>Like new</option><option>Good</option><option>Fair</option></select>
                </div>
                <div className="form-field">
                  <label htmlFor="listing-max-days">Maximum days</label>
                  <input aria-describedby={listingFieldErrors.max_days ? 'listing-max-days-error' : undefined} aria-invalid={Boolean(listingFieldErrors.max_days)} id="listing-max-days" name="max_days" type="number" min="1" max="365" defaultValue={listingInitial?.max_days || 7} autoComplete="off" required />
                  <FieldError id="listing-max-days-error" message={listingFieldErrors.max_days} />
                </div>
              </div>
              <div className="date-fields">
                <div className="form-field">
                  <label htmlFor="listing-deposit">Deposit amount</label>
                  <input aria-describedby={listingFieldErrors.deposit_amount ? 'listing-deposit-error' : undefined} aria-invalid={Boolean(listingFieldErrors.deposit_amount)} id="listing-deposit" name="deposit_amount" type="number" min="0" step="0.01" defaultValue={listingInitial?.deposit_amount || 0} autoComplete="off" />
                  <FieldError id="listing-deposit-error" message={listingFieldErrors.deposit_amount} />
                </div>
                <div className="form-field">
                  <label htmlFor="listing-location">Pickup location</label>
                  <input id="listing-location" name="location" type="text" maxLength="160" defaultValue={listingInitial?.location || ''} autoComplete="address-level2" />
                </div>
              </div>
              {listingInitial && <div className="form-field"><label htmlFor="listing-availability">Availability</label><select id="listing-availability" name="is_available" defaultValue={String(listingInitial.is_available)} autoComplete="off"><option value="true">Available</option><option value="false">Paused</option></select></div>}
              {!listingInitial && (
                <div className="form-field">
                  <label htmlFor="listing-images">Photos (up to 5)</label>
                  <input
                    id="listing-images"
                    name="images"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={listingBusy || listingFiles.length >= 5}
                    aria-describedby={listingFileError ? 'listing-images-error' : undefined}
                    onChange={handleListingFilesChange}
                  />
                  {listingFileError && <p className="field-error" id="listing-images-error" role="alert">{listingFileError}</p>}
                  {listingFiles.length > 0 && (
                    <div className="listing-photo-previews">
                      {listingFiles.map(({ file, previewUrl }) => (
                        <div className="listing-photo-preview" key={previewUrl}>
                          <img src={previewUrl} alt={`Preview of ${file.name}`} />
                          <button
                            type="button"
                            disabled={listingBusy}
                            aria-label={`Remove ${file.name}`}
                            onClick={() => {
                              URL.revokeObjectURL(previewUrl)
                              listingPreviewUrlsRef.current.delete(previewUrl)
                              setListingFiles((currentFiles) => currentFiles.filter((currentFile) => currentFile.previewUrl !== previewUrl))
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {listingError && <p className="form-error" role="alert">{listingError}</p>}
              <button className="primary-button form-submit" disabled={listingBusy} type="submit">{listingBusy ? 'Saving...' : listingInitial ? 'Save changes' : 'Publish listing'}</button>
            </form>
          </section>
        </div>
      )}

      {showProfile && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeProfile() }}>
          <section className="form-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" tabIndex="-1">
            <button className="modal-close" onClick={closeProfile} type="button" aria-label="Close">×</button>
            {profileError ? <p className="form-error" role="alert">{profileError}</p> : !profile ? (
              <div className="status-panel" role="status"><span className="loader" /> Loading profile...</div>
            ) : (
              <>
                <p className="eyebrow">COMMUNITY MEMBER</p>
                <h2 id="profile-title">{profile.user.name}</h2>
                <p className="profile-summary">
                  {profile.user.location || 'Local community member'}
                  {profile.user.is_verified && <span className="verified-label">Verified</span>}
                </p>
                <div className="profile-rating" aria-label="Trust score">
                  <span className="profile-stars">{Array.from({ length: 5 }, (_, index) => (
                    <span key={`star-${index}`}>{index < Math.round(Number(profile.user.trust_score || 0) || 0) ? '★' : '☆'}</span>
                  ))}</span>
                  <strong>{profile.user.trust_score ? Number(profile.user.trust_score).toFixed(1) : 'New'}</strong>
                  <span>{profile.review_count} {profile.review_count === 1 ? 'review' : 'reviews'}</span>
                </div>
                <div className="profile-items">
                  <h3>Items</h3>
                  {profileItems.length === 0 ? <p className="dashboard-empty">No listings yet.</p> : (
                    <div className="profile-item-grid">
                      {profileItems.map((item) => (
                        <button className="profile-item-card" key={item.id} onClick={() => { closeProfile(); openItem(item) }} type="button">
                          <span className="profile-item-image">{item.image_url ? <img src={item.image_url} alt={item.title} /> : <span aria-hidden="true">{item.title?.slice(0, 1) || 'B'}</span>}</span>
                          <span className="profile-item-meta">
                            <strong>{item.title}</strong>
                            <small>${Number(item.deposit_amount || 0).toFixed(0)} deposit</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="profile-reviews">
                  <h3>Reviews</h3>
                  {profile.reviews.length === 0 ? <p className="dashboard-empty">No reviews yet.</p> : profile.reviews.map((review) => (
                    <article className="profile-review" key={review.id}>
                      <div><strong>{review.reviewer_name}</strong><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div>
                      {review.comment && <p>{review.comment}</p>}
                      <time>{new Date(review.created_at).toLocaleDateString()}</time>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {infoPage && (
        <div className="modal-backdrop info-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInfoPage(null) }}>
          <section className="form-modal info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title" tabIndex="-1">
            <button className="modal-close" onClick={() => setInfoPage(null)} type="button" aria-label="Close">×</button>
            <p className="eyebrow">BORROWBOX</p>
            <h2 id="info-title">{infoSections[infoPage].title}</h2>
            <p className="info-intro">{infoSections[infoPage].intro}</p>

            {infoPage === 'how-it-works' && (
              <ol className="info-steps">
                {infoSections[infoPage].content.map((item) => (
                  <li className="info-step" key={item.step}>
                    <span className="step-number">{item.step}</span>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {infoPage === 'faq' && (
              <div className="faq-list">
                {infoSections[infoPage].content.map((item) => (
                  <div className="faq-item" key={item.question}>
                    <h3>{item.question}</h3>
                    <p>{item.answer}</p>
                  </div>
                ))}
              </div>
            )}

            {(infoPage === 'about' || infoPage === 'terms' || infoPage === 'privacy') && (
              <div className="info-copy-list">
                {infoSections[infoPage].content.map((paragraph, index) => (
                  <p key={`${infoPage}-${index}`}>{paragraph}</p>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {confirmation && (
        <div className="modal-backdrop confirmation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !confirmationBusy) setConfirmation(null) }}>
          <section className="form-modal confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" tabIndex="-1">
            <h2 id="confirmation-title">{confirmation.title}</h2>
            <p id="confirmation-message">{confirmation.message}</p>
            <div className="confirmation-actions">
              <button className="quiet-button" disabled={confirmationBusy} onClick={() => setConfirmation(null)} type="button">Go back</button>
              <button className="primary-button" disabled={confirmationBusy} onClick={confirmAction} type="button">{confirmationBusy ? 'Please wait...' : confirmation.confirmLabel}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
