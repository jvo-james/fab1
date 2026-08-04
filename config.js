window.FAB_CONFIG = {
  businessName: "FAUSTINA'S SPARKLY SERVICES",
  email: "faustinaaffumdwamena@gmail.com",
  phoneDisplay: "07741 038 945",
  phoneInternational: "+447741038945",
  whatsappNumber: "447741038945",
  openingHours: "Monday–Friday, 6am–11pm",
  serviceAreas: ["Manchester", "London", "Luton", "Salford", "Stockport", "Bolton", "Oldham"],
  postcodePrefixes: ["M", "OL", "BL", "SK", "LU", "E", "EC", "N", "NW", "SE", "SW", "W", "WC"],
  serviceAreaTowns: ["Manchester", "London", "Luton", "Salford", "Stockport", "Bolton", "Oldham"],
  emailjs: {
    publicKey: "cYsFGqfQFfG77HC46",
    serviceId: "service_wm1hy4l",
    bookingTemplateId: "template_400ux3i",
    feedbackTemplateId: "template_0pvzp8l",
    applicationTemplateId: "template_0pvzp8l",
    enquiryTemplateId: "template_0pvzp8l",
    adminMessageTemplateId: "template_0pvzp8l",
    adminEmail: "faustinaaffumdwamena@gmail.com"
  },
  rates: {
    regular: { name: "Regular clean", hourly: 17, minimumHours: 2 },
    kitchen: { name: "Kitchen & bathroom clean", hourly: 20, minimumHours: 2 },
    deep: { name: "Deep clean", hourly: 24, minimumHours: 3 },
    holiday: { name: "Holiday rental", hourly: 21, minimumHours: 2 },
    oneoff: { name: "One-off clean", hourly: 20, minimumHours: 2 },
    tenancy: { name: "End of tenancy", hourly: 26, minimumHours: 4 },
    oven: { name: "Oven & hob clean", fixed: 20, minimumHours: 1, pricePrefix: "from" },
    carpet: { name: "Carpet & upholstery", quoteOnly: true }
  },
  timeSlots: [
    { id: "morning", label: "Morning", start: "08:00", end: "12:00" },
    { id: "afternoon", label: "Afternoon", start: "13:00", end: "17:00" },
    { id: "evening", label: "Evening", start: "18:00", end: "22:00" }
  ],
  workingDays: [1, 2, 3, 4, 5],
  responseTime: "within one working day",
  bookingMode: "deposit",
  depositAmount: 25,
  netlifyCheckoutEndpoint: "/.netlify/functions/create-checkout-session",
  serviceRegions: {
    "greater-manchester": ["Manchester", "Salford", "Stockport", "Bolton", "Oldham"],
    "london-luton": ["London", "Luton"]
  },

  // Replace the six blank values below with the Web App configuration
  // shown in Firebase Console → Project settings → Your apps.
  appCheckSiteKey: "", // Add a reCAPTCHA Enterprise site key before enforcing App Check.
  firebase: {
       apiKey: "AIzaSyANCSiAlpUMA29DcyqNbnicGhV1mGl7Moo",
    authDomain: "fab-cleaning-new.firebaseapp.com",
    projectId: "fab-cleaning-new",
    storageBucket: "fab-cleaning-new.firebasestorage.app",
    messagingSenderId: "1027066992567",
    appId: "1:1027066992567:web:098a7d1e6473e569e1ba32"
  }
};
