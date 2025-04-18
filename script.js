const debugMode = true; // True for local live-server debug

if (debugMode) {
    document.addEventListener('DOMContentLoaded', () => {
        const screens = [
            'paymentScreen', 'chargeScreen', 'paymentOptionsScreen',
            'manualCardScreen', 'venmoScreen', 'receiptScreen', 'updateProfileScreen'
        ];
        screens.forEach(id => {
            const screen = document.getElementById(id);
            if (screen) screen.style.display = 'block';
        });
        console.log('Debug mode: All screens displayed');
    });
}

let map, directionsService, directionsRenderer;
let startLocation, endLocation, startTime, endTime;
let squarePayments;
let waitStartTime;
let waitCost = 0;
let selectedTip = null;

async function initializeSquare() {
    try {
        console.log('Starting Square initialization...');
        const response = await fetch('/config');
        if (!response.ok) {
            throw new Error(`Fetch /config failed: ${response.statusText}`);
        }
        const config = await response.json();
        if (!config.squareAppId || !config.squareLocationId) {
            throw new Error('Missing squareAppId or squareLocationId in /config response');
        }
        if (!window.Square) {
            throw new Error('Square SDK not loaded - check script in index.html');
        }
        squarePayments = await window.Square.payments(config.squareAppId, config.squareLocationId);
        console.log('Square Payments initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Square:', error.message);
        squarePayments = null; // Ensure it’s null if failed
    }
}

// Call it immediately

// Helper function to set tip labels
function setTipLabels(baseAmount) {
    document.getElementById('tip15').innerText = `15% - $${(baseAmount * 0.15).toFixed(2)}`;
    document.getElementById('tip20').innerText = `20% - $${(baseAmount * 0.20).toFixed(2)}`;
    document.getElementById('tip25').innerText = `25% - $${(baseAmount * 0.25).toFixed(2)}`;
    document.getElementById('tipCustom').innerText = 'Custom';
}

function toggleDarkMode() {
    const isDark = document.getElementById('darkModeToggle').checked;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    console.log('Theme switched to:', isDark ? 'dark' : 'light');
}

// Initialize Google Map
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 44.8549, lng: -93.4708 },
        zoom: 12
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
    directionsRenderer.setMap(map);
    initAutocomplete();
}

// Initialize Autocomplete for address inputs
function initAutocomplete() {
    const startInput = document.getElementById('startAddress');
    const destInput = document.getElementById('destination');

    const autocompleteStart = new google.maps.places.Autocomplete(startInput, {
        types: ['geocode'],
        fields: ['formatted_address']
    });
    const autocompleteDest = new google.maps.places.Autocomplete(destInput, {
        types: ['geocode'],
        fields: ['formatted_address']
    });
}

// On Our Way - Start ride from driver's current location to customer's Start Address
function onOurWay() {
    const startAddressInput = document.getElementById('startAddress');
    const destinationInput = document.getElementById('destination');
    const clientPhoneInput = document.getElementById('clientPhone');
    const driverNameInput = document.getElementById('driverName');
    const navOptions = document.getElementById('navOptions');

    const startAddress = startAddressInput ? startAddressInput.value : '';
    const destination = destinationInput ? destinationInput.value : '';
    const clientPhone = clientPhoneInput ? clientPhoneInput.value.trim() : '';
    const driverName = driverNameInput ? driverNameInput.value : '';

    if (!startAddress || !destination || !clientPhone) {
        document.getElementById('status').innerText = 'Please enter start address, destination, and client phone.';
        return;
    }
    if (!/^\d{10}$/.test(clientPhone.replace(/[^\d]/g, ''))) {
        document.getElementById('status').innerText = 'Please enter a valid 10-digit phone number (e.g., 1234567890).';
        return;
    }

    if (navigator.geolocation) {
        document.getElementById('status').innerText = 'Fetching driver location...';
        navigator.geolocation.getCurrentPosition(position => {
            const driverLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            startTime = new Date();
            const request = {
                origin: new google.maps.LatLng(driverLocation.lat, driverLocation.lng),
                destination: startAddress,
                travelMode: 'DRIVING'
            };
            directionsService.route(request, (result, status) => {
                if (status === 'OK') {
                    directionsRenderer.setDirections(result);
                    const duration = result.routes[0].legs[0].duration.value / 60;
                    const eta = new Date(startTime.getTime() + duration * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const smsMessage = `Your driver, ${driverName}, is on the way from their location. Estimated ETA to your pickup: ${eta}`;
                    window.location.href = `sms:${clientPhone}&body=${encodeURIComponent(smsMessage)}`;
                    document.getElementById('status').innerText = `On our way to pickup. ETA: ${eta}`;
                    document.getElementById('onOurWayBtn').style.display = 'none';
                    document.getElementById('arriveBtn').style.display = 'block';
                    document.getElementById('rideDetails').style.display = 'none';
                    document.getElementById('toggleDetailsBtn').style.display = 'block';
                    document.getElementById('toggleDetailsBtn').innerText = 'Show Ride Details';
                    document.getElementById('map').style.height = '400px';
                    navOptions.style.display = 'flex';
                    // Update button onclicks for start address
                    document.getElementById('googleNavBtn').onclick = () => navigateToStart('google');
                    document.getElementById('appleNavBtn').onclick = () => navigateToStart('apple');
                    console.log('On Our Way: Navigation options shown for pickup');
                } else {
                    document.getElementById('status').innerText = 'Failed to calculate ETA.';
                }
            });
        }, error => {
            console.error('Geolocation error:', error.message, 'Code:', error.code);
            document.getElementById('status').innerText = `Geolocation failed: ${error.message}`;
        }, {
            maximumAge: 0,
            timeout: 10000,
            enableHighAccuracy: true
        });
    } else {
        document.getElementById('status').innerText = 'Geolocation not supported.';
    }
}

// Arrive at customer's pickup location
function arrive() {
    const startAddressInput = document.getElementById('startAddress');
    const destinationInput = document.getElementById('destination');
    const statusDiv = document.getElementById('status');
    const arriveBtn = document.getElementById('arriveBtn');
    const startRideBtn = document.getElementById('startRideBtn');

    const startAddress = startAddressInput ? startAddressInput.value : '';
    const destination = destinationInput ? destinationInput.value : '';

    if (!startAddress || !destination) {
        statusDiv.innerText = 'Please enter start address and destination.';
        console.log('Arrive: Missing startAddress or destination');
        return;
    }

    if (!navigator.geolocation) {
        statusDiv.innerText = 'Geolocation not supported.';
        console.log('Arrive: Geolocation not supported');
        return;
    }

    statusDiv.innerText = 'Fetching pickup location...';
    console.log('Arrive: Fetching geolocation...');
    arriveBtn.disabled = true; // Prevent double-click

    navigator.geolocation.getCurrentPosition(position => {
        startLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        console.log('Arrive: Geolocation success - Start Location:', startLocation);
        map.setCenter(startLocation);
        waitStartTime = new Date();
        console.log('Arrive: waitStartTime set to', waitStartTime);
        statusDiv.innerText = 'Arrived at pickup.';
        arriveBtn.style.display = 'none';
        startRideBtn.style.display = 'block';
        console.log('Arrive: Button state updated - arriveBtn hidden, startRideBtn shown');
        arriveBtn.disabled = false; // Re-enable for future use
    }, error => {
        console.error('Arrive: Geolocation error:', error.message, 'Code:', error.code);
        statusDiv.innerText = `Geolocation failed: ${error.message}`;
        arriveBtn.disabled = false;
    }, {
        maximumAge: 0,
        timeout: 10000,
        enableHighAccuracy: true
    });
}

function startRide() {
    const statusDiv = document.getElementById('status');
    const destinationInput = document.getElementById('destination');
    const startRideBtn = document.getElementById('startRideBtn');
    const finishRideBtn = document.getElementById('finishRideBtn');
    const navOptions = document.getElementById('navOptions');
    const destination = destinationInput ? destinationInput.value : '';

    if (!waitStartTime) {
        statusDiv.innerText = 'Please arrive at pickup first.';
        console.log('Start Ride: waitStartTime not set');
        return;
    }

    if (!destination) {
        statusDiv.innerText = 'Please enter a destination.';
        console.log('Start Ride: Missing destination');
        return;
    }

    const waitEndTime = new Date();
    const waitTimeMs = waitEndTime - waitStartTime;
    const waitTimeMin = waitTimeMs / 60000;
    waitCost = waitTimeMin > 15 ? (waitTimeMin - 15) * 0.50 : 0;

    statusDiv.innerText = waitCost > 0 
        ? `Wait time cost: $${waitCost.toFixed(2)}. Starting ride...`
        : 'No wait time cost. Starting ride...';
    console.log('Start Ride: Fetching current location...');

    navigator.geolocation.getCurrentPosition(position => {
        const currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        console.log('Start Ride: Geolocation success - Current Location:', currentLocation);

        const request = {
            origin: new google.maps.LatLng(currentLocation.lat, currentLocation.lng),
            destination: destination,
            travelMode: 'DRIVING'
        };
        console.log('Start Ride: Routing request:', request);

        directionsService.route(request, (result, status) => {
            console.log('Start Ride: Directions API response - Status:', status, 'Result:', result);
            if (status === 'OK') {
                directionsRenderer.setDirections(result);
                statusDiv.innerText = waitCost > 0 
                    ? `Wait time cost: $${waitCost.toFixed(2)}. Ride started, route updated.`
                    : 'Ride started, route updated.';
                startRideBtn.style.display = 'none';
                finishRideBtn.style.display = 'block';
                navOptions.style.display = 'flex';
                // Update button onclicks for destination
                document.getElementById('googleNavBtn').onclick = () => navigateToDestination('google');
                document.getElementById('appleNavBtn').onclick = () => navigateToDestination('apple');
                startTime = new Date();
                console.log('Start Ride: Route updated, navigation options shown for destination');
            } else {
                statusDiv.innerText = 'Failed to update route: ' + status;
                console.error('Start Ride: Directions API failed:', status);
            }
        });
    }, error => {
        console.error('Start Ride: Geolocation error:', error.message, 'Code:', error.code);
        statusDiv.innerText = `Geolocation failed: ${error.message}`;
    }, {
        maximumAge: 0,
        timeout: 10000,
        enableHighAccuracy: true
    });
}

function navigateToStart(app) {
    const startAddressInput = document.getElementById('startAddress');
    const statusDiv = document.getElementById('status');
    const startAddress = startAddressInput ? startAddressInput.value : '';

    if (!startAddress) {
        statusDiv.innerText = 'No start address provided.';
        console.log('NavigateToStart: No start address provided');
        return;
    }

    navigator.geolocation.getCurrentPosition(position => {
        const currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        console.log('NavigateToStart: Current Location:', currentLocation);

        const origin = `${currentLocation.lat},${currentLocation.lng}`;
        const encodedDest = encodeURIComponent(startAddress);

        if (app === 'google') {
            const googleAppUrl = `comgooglemaps://?saddr=${origin}&daddr=${encodedDest}&directionsmode=driving`;
            window.location.href = googleAppUrl;
            setTimeout(() => {
                if (document.hasFocus()) {
                    statusDiv.innerText = 'Google Maps app not installed. Please install it to navigate.';
                    console.log('NavigateToStart: Google Maps app not installed');
                } else {
                    console.log('NavigateToStart: Google Maps app opened');
                }
            }, 1000);
        } else if (app === 'apple') {
            const appleAppUrl = `maps://?saddr=${origin}&daddr=${encodedDest}&dirflg=d`;
            window.location.href = appleAppUrl;
            setTimeout(() => {
                if (document.hasFocus()) {
                    statusDiv.innerText = 'Apple Maps app not installed. Please install it to navigate.';
                    console.log('NavigateToStart: Apple Maps app not installed');
                } else {
                    console.log('NavigateToStart: Apple Maps app opened');
                }
            }, 1000);
        }
    }, error => {
        console.error('NavigateToStart: Geolocation error:', error.message, 'Code:', error.code);
        statusDiv.innerText = `Navigation failed: ${error.message}`;
    }, {
        maximumAge: 0,
        timeout: 10000,
        enableHighAccuracy: true
    });
}

function navigateToDestination(app) {
    const destinationInput = document.getElementById('destination');
    const statusDiv = document.getElementById('status');
    const destination = destinationInput ? destinationInput.value : '';

    if (!destination) {
        statusDiv.innerText = 'No destination provided.';
        console.log('NavigateToDestination: No destination provided');
        return;
    }

    navigator.geolocation.getCurrentPosition(position => {
        const currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };
        console.log('NavigateToDestination: Current Location:', currentLocation);

        const origin = `${currentLocation.lat},${currentLocation.lng}`;
        const encodedDest = encodeURIComponent(destination);

        if (app === 'google') {
            const googleAppUrl = `comgooglemaps://?saddr=${origin}&daddr=${encodedDest}&directionsmode=driving`;
            window.location.href = googleAppUrl;
            setTimeout(() => {
                if (document.hasFocus()) {
                    statusDiv.innerText = 'Google Maps app not installed. Please install it to navigate.';
                    console.log('NavigateToDestination: Google Maps app not installed');
                } else {
                    console.log('NavigateToDestination: Google Maps app opened');
                }
            }, 1000);
        } else if (app === 'apple') {
            const appleAppUrl = `maps://?saddr=${origin}&daddr=${encodedDest}&dirflg=d`;
            window.location.href = appleAppUrl;
            setTimeout(() => {
                if (document.hasFocus()) {
                    statusDiv.innerText = 'Apple Maps app not installed. Please install it to navigate.';
                    console.log('NavigateToDestination: Apple Maps app not installed');
                } else {
                    console.log('NavigateToDestination: Apple Maps app opened');
                }
            }, 1000);
        }
    }, error => {
        console.error('NavigateToDestination: Geolocation error:', error.message, 'Code:', error.code);
        statusDiv.innerText = `Navigation failed: ${error.message}`;
    }, {
        maximumAge: 0,
        timeout: 10000,
        enableHighAccuracy: true
    });
}

// Finish the ride at destination
function finishRide() {
    const destination = document.getElementById('destination').value;
    if (!destination) {
        document.getElementById('status').innerText = 'Please enter destination.';
        console.log('No destination entered');
        return;
    }
    console.log('Starting geolocation for Finish Ride');
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            console.log('Geolocation success:', position.coords);
            endLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            endTime = new Date();
            const timeDiff = (endTime - startTime) / 60000;
            const request = {
                origin: new google.maps.LatLng(startLocation.lat, startLocation.lng),
                destination: destination,
                travelMode: 'DRIVING'
            };
            console.log('Requesting route:', request);
            directionsService.route(request, (result, status) => {
                console.log('Route result:', status, result);
                if (status === 'OK') {
                    directionsRenderer.setDirections(result);
                    console.log('Switching to charge screen');
                    document.getElementById('paymentScreen').style.display = 'none';
                    document.getElementById('finishRideBtn').style.display = 'none';
                    document.getElementById('chargeScreen').style.display = 'block';
                    window.baseAmount = waitCost > 0 ? waitCost : 0; // Initial base includes wait cost
                } else {
                    document.getElementById('status').innerText = 'Failed to calculate route.';
                    console.log('Route failed:', status);
                }
            });
        }, error => {
            document.getElementById('status').innerText = 'Geolocation failed.';
            console.log('Geolocation error:', error);
        });
    } else {
        document.getElementById('status').innerText = 'Geolocation not supported.';
        console.log('Geolocation not supported');
    }
}

// Capitalize first letter of each name part
function capitalizeName(name) {
    const parts = name.trim().split(' ');
    for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
            parts[i] = parts[i][0].toUpperCase() + parts[i].slice(1).toLowerCase();
        }
    }
    return parts.join(' ');
}

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.getElementById('darkModeToggle').checked = true;
        document.documentElement.setAttribute('data-theme', 'dark');
    }
});

window.onload = function() {
    const driverNameInput = document.getElementById('driverName');
    const driverEmailInput = document.getElementById('driverEmail');
    let savedDriver = localStorage.getItem('defaultDriver');
    let savedEmail = localStorage.getItem('driverEmail');
    let savedPhone = localStorage.getItem('driverPhone');

    if (!savedDriver || !savedEmail || !savedPhone) {
        savedDriver = prompt('What’s your name? (e.g., Darwin Belleza)') || '';
        if (savedDriver) {
            savedDriver = capitalizeName(savedDriver);
            localStorage.setItem('defaultDriver', savedDriver);
        }
        savedEmail = prompt('What’s your email? (e.g., darwin@example.com)') || '';
        if (savedEmail) {
            localStorage.setItem('driverEmail', savedEmail);
        }
        savedPhone = prompt('What’s your phone number? (e.g., 12345678900)') || '';
        if (savedPhone) {
            localStorage.setItem('driverPhone', savedPhone);
        }
    }

    if (driverNameInput) driverNameInput.value = savedDriver;
    if (driverEmailInput) driverEmailInput.value = savedEmail;
    console.log('Calling initializeSquare');
    initializeSquare().then(() => {
        console.log('Square initialized after profile setup');
    }).catch(error => {
        console.log('Initialization failed:', error.message || error);
    });
};

function toggleRideDetails() {
    const rideDetails = document.getElementById('rideDetails');
    const toggleBtn = document.getElementById('toggleDetailsBtn');
    if (rideDetails.style.display === 'none' || rideDetails.style.display === '') {
        rideDetails.style.display = 'block';
        toggleBtn.innerText = 'Hide Ride Details';
    } else {
        rideDetails.style.display = 'none';
        toggleBtn.innerText = 'Show Ride Details';
    }
}


// Update profile
function showUpdateProfile() {
    const updateProfileScreen = document.getElementById('updateProfileScreen');
    const paymentScreen = document.getElementById('paymentScreen');
    const driverNameInput = document.getElementById('driverName');
    const driverEmailInput = document.getElementById('driverEmail');

    // Pre-fill fields with current values
    document.getElementById('updateName').value = driverNameInput.value || localStorage.getItem('defaultDriver') || '';
    document.getElementById('updateEmail').value = driverEmailInput.value || localStorage.getItem('driverEmail') || '';
    document.getElementById('updatePhone').value = localStorage.getItem('driverPhone') || '';

    paymentScreen.style.display = 'none';
    updateProfileScreen.style.display = 'block';
    document.getElementById('menuDropdown').style.display = 'none'; // Close menu
}

function hideUpdateProfile() {
    const updateProfileScreen = document.getElementById('updateProfileScreen');
    const paymentScreen = document.getElementById('paymentScreen');
    updateProfileScreen.style.display = 'none';
    paymentScreen.style.display = 'block';
}

function saveProfile() {
    const newName = document.getElementById('updateName').value;
    const newEmail = document.getElementById('updateEmail').value;
    const newPhone = document.getElementById('updatePhone').value;
    const driverNameInput = document.getElementById('driverName');
    const driverEmailInput = document.getElementById('driverEmail');

    if (newName) {
        const formattedName = capitalizeName(newName);
        localStorage.setItem('defaultDriver', formattedName);
        driverNameInput.value = formattedName;
    }
    if (newEmail) {
        localStorage.setItem('driverEmail', newEmail);
        driverEmailInput.value = newEmail;
    }
    if (newPhone) {
        localStorage.setItem('driverPhone', newPhone);
    }

    console.log('Profile updated:', { name: newName, email: newEmail, phone: newPhone });
    hideUpdateProfile();
}


// Go directly to $5 increment payment screen without rider info
function chargeNow() {
    console.log('Charge Now clicked');
    const paymentScreen = document.getElementById('paymentScreen');
    const chargeScreen = document.getElementById('chargeScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const statusDiv = document.getElementById('status');
    const amountInput = document.getElementById('amount');

    // Hide other screens and show charge screen
    paymentScreen.style.display = 'none';
    receiptScreen.style.display = 'none';
    chargeScreen.style.display = 'block';

    // Clear rider info only, keep driver info
    amountInput.value = '';
    document.getElementById('startAddress').value = '';
    document.getElementById('destination').value = '';
    document.getElementById('clientPhone').value = '';
    statusDiv.innerText = '';

    // Close the menu
    document.getElementById('menuDropdown').style.display = 'none';
    console.log('Charge Now completed - showing charge screen');
}

// Manual credit card payment
function manualPayment() {
    console.log('Manual payment selected');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const chargeScreen = document.getElementById('chargeScreen');
    const statusDiv = document.getElementById('status');
    paymentOptionsScreen.style.display = 'none';
    chargeScreen.style.display = 'block';
    statusDiv.innerText = 'Select amount for manual card entry';
}

// Tap-to-pay payment
function tapPayment() {
    console.log('Tap-to-pay selected');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const statusDiv = document.getElementById('status');
    const driverName = document.getElementById('driverName').value;

    paymentOptionsScreen.style.display = 'none';
    receiptScreen.style.display = 'block';
    statusDiv.innerText = 'Tap-to-pay processed (mocked for web)';
    console.log('Tap-to-pay mocked - awaiting iOS implementation');
    setTipLabels(window.baseAmount); // Already here
    document.getElementById('driverInfo').innerText = `Driver: ${driverName}`;
    document.getElementById('rideInfo').innerText = `Amount: $${window.baseAmount.toFixed(2)} - ${window.paymentNote}`;
}

function venmoPayment() {
    console.log('Venmo payment selected');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const venmoScreen = document.getElementById('venmoScreen');
    const statusDiv = document.getElementById('status');

    if (!venmoScreen) {
        console.error('Venmo screen not found in DOM');
        statusDiv.innerText = 'Error: Venmo screen not available';
        return;
    }

    paymentOptionsScreen.style.display = 'none';
    venmoScreen.style.display = 'block';
    statusDiv.innerText = 'Scan the Venmo QR code to pay, then click Finish Payment';
    console.log('Venmo screen displayed');

    const qrImage = document.getElementById('venmoQrCode');
    qrImage.onerror = () => {
        console.error('Venmo QR image failed to load from /public/venmo-qr.jpg');
        statusDiv.innerText = 'Error: Venmo QR code image not found';
    };
    qrImage.onload = () => {
        console.log('Venmo QR image loaded successfully');
    };
    // Force reload to trigger load/error events
    qrImage.src = qrImage.src + '?' + new Date().getTime();
}

function backToPaymentOptions() {
    const venmoScreen = document.getElementById('venmoScreen');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const statusDiv = document.getElementById('status');

    venmoScreen.style.display = 'none';
    paymentOptionsScreen.style.display = 'block';
    statusDiv.innerText = 'Choose payment method';
}

function finishVenmoPayment() {
    const venmoScreen = document.getElementById('venmoScreen');
    const paymentScreen = document.getElementById('paymentScreen');
    const statusDiv = document.getElementById('status');
    const driverName = document.getElementById('driverName').value;
    const amountInput = document.getElementById('amount');
    const amount = parseFloat(amountInput.value);
    const baseFare = window.baseAmount;
    const tipAmount = (amount - baseFare).toFixed(2); // Assume no tip for Venmo simplicity
    const driverPay = (baseFare * 0.72).toFixed(2); // No tip added

    // Hide Venmo screen
    venmoScreen.style.display = 'none';

    // Mock transaction completion
    statusDiv.innerText = 'Venmo payment processed (mocked for web)';
    console.log('Venmo payment mocked - transaction completed');

    // Save ride history
    const ride = {
        dateTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
        fare: baseFare.toFixed(2),
        tip: "0.00", // No tip for Venmo flow
        total: baseFare.toFixed(2),
        driverPay: driverPay,
        startAddress: document.getElementById('startAddress').value,
        destination: document.getElementById('destination').value,
        distance: ((endLocation && startLocation) ? (google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(startLocation.lat, startLocation.lng),
            new google.maps.LatLng(endLocation.lat, endLocation.lng)
        ) / 1609.34).toFixed(1) : 'N/A'),
        time: ((endTime && startTime) ? ((endTime - startTime) / 60000).toFixed(1) : 'N/A'),
        waitCost: waitCost.toFixed(2)
    };
    let history = JSON.parse(localStorage.getItem('rideHistory') || '[]');
    history.push(ride);
    localStorage.setItem('rideHistory', JSON.stringify(history));

    // Reset UI to paymentScreen
    paymentScreen.style.display = 'block';
    document.getElementById('chargeScreen').style.display = 'none';
    document.getElementById('paymentOptionsScreen').style.display = 'none';
    document.getElementById('receiptScreen').style.display = 'none';
    document.getElementById('manualCardScreen').style.display = 'none';
    document.getElementById('venmoScreen').style.display = 'none';
    amountInput.value = '';
    document.getElementById('startAddress').value = '';
    document.getElementById('destination').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('onOurWayBtn').style.display = 'block';
    document.getElementById('arriveBtn').style.display = 'none';
    document.getElementById('startRideBtn').style.display = 'none';
    document.getElementById('finishRideBtn').style.display = 'none';
    document.getElementById('navOptions').style.display = 'none';
    map.setCenter({ lat: 44.8549, lng: -93.4708 });
    directionsRenderer.set('directions', null);
    statusDiv.innerText = 'Payment Successful! Total: $' + baseFare.toFixed(2);
    statusDiv.className = 'success';

    // Clear status after 5 seconds
    setTimeout(() => {
        statusDiv.innerText = '';
        statusDiv.className = '';
        console.log('UI reset to paymentScreen after Venmo payment');
    }, 5000);
}

// Set amount from price buttons
function setAmount(price) {
    const amountInput = document.getElementById('amount');
    const statusDiv = document.getElementById('status');
    const buttons = document.querySelectorAll('.charge-btn');

    // Remove selected class from all buttons
    buttons.forEach(btn => btn.classList.remove('selected'));

    // Find and highlight the clicked button
    const clickedButton = Array.from(buttons).find(btn => btn.textContent === (price === 'variable' ? 'Custom' : `$${price}`));
    if (clickedButton) {
        clickedButton.classList.add('selected');
    }

    // Set amount
    if (price === 'variable') {
        const customAmount = prompt('Enter custom amount (e.g., 27.50)');
        if (customAmount && !isNaN(customAmount) && customAmount > 0) {
            amountInput.value = parseFloat(customAmount).toFixed(2);
        } else {
            statusDiv.innerText = 'Invalid amount';
            statusDiv.className = 'error';
            clickedButton.classList.remove('selected');
            return;
        }
    } else {
        amountInput.value = price.toFixed(2);
    }
    statusDiv.innerText = `Amount set to $${amountInput.value}`;
}

// Trigger Square payment with preset amount
function triggerPayment() {
    const amountInput = document.getElementById('amount');
    const driverNameInput = document.getElementById('driverName');
    const statusDiv = document.getElementById('status');
    const chargeScreen = document.getElementById('chargeScreen');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const amount = amountInput.value;
    const driverName = driverNameInput.value;

    if (!amount || amount <= 0 || isNaN(amount)) {
        statusDiv.innerText = 'Please select a valid amount';
        statusDiv.className = 'error';
        console.log('Trigger Payment: Invalid amount');
        return;
    }
    if (!driverName) {
        statusDiv.innerText = 'Driver name not set';
        statusDiv.className = 'error';
        console.log('Trigger Payment: Driver name missing');
        return;
    }

    console.log('Showing payment options with amount:', amount);
    window.baseAmount = parseFloat(amount);
    chargeScreen.style.display = 'none';
    paymentOptionsScreen.style.display = 'block';
    statusDiv.innerText = 'Choose payment method';
    setTipLabels(window.baseAmount);
}

function showMoreCharges() {
    const moreChargeButtons = document.getElementById('moreChargeButtons');
    const moreChargeBtn = document.getElementById('moreChargeBtn');
    moreChargeButtons.style.display = 'block';
    moreChargeBtn.style.display = 'none';
    console.log('More charge options shown');
}

// Manual credit card payment
async function manualPayment() {
    console.log('Manual payment selected');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const manualCardScreen = document.getElementById('manualCardScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const chargeScreen = document.getElementById('chargeScreen');
    const statusDiv = document.getElementById('status');
    const driverName = document.getElementById('driverName').value;
    const cardContainer = document.getElementById('card-container');

    paymentOptionsScreen.style.display = 'none';
    manualCardScreen.style.display = 'block';
    chargeScreen.style.display = 'none';
    statusDiv.innerText = 'Loading card form...';
    document.getElementById('ride-amount').innerText = window.baseAmount.toFixed(2);

    try {
        // Wait for squarePayments with timeout
        let attempts = 0;
        while (!squarePayments && attempts < 10) { // Increased to 10s
            console.log('Waiting for squarePayments to initialize...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }
        if (!squarePayments) {
            throw new Error('Square payments not initialized after waiting');
        }

        if (window.card) {
            console.log('Destroying previous card instance');
            await window.card.destroy();
            window.card = null;
        }
        console.log('Clearing card container');
        cardContainer.innerHTML = '';
        console.log('Creating new Square card instance');
        window.card = await squarePayments.card();
        console.log('Attaching card form to #card-container');
        await window.card.attach('#card-container');
        console.log('Card form attached successfully');
        statusDiv.innerText = 'Enter card details below, then proceed to tip';

        document.getElementById('card-button').onclick = async () => {
            manualCardScreen.style.display = 'none';
            receiptScreen.style.display = 'block';
            statusDiv.innerText = 'Add tip to complete payment';
            setTipLabels(window.baseAmount);
            updateTipButtonStyles();
        };

        document.getElementById('back-to-charge').onclick = () => {
            manualCardScreen.style.display = 'none';
            chargeScreen.style.display = 'block';
            statusDiv.innerText = 'Select amount for manual card entry';
        };
    } catch (error) {
        console.error('Card initialization error:', error.message || error);
        statusDiv.innerText = 'Failed to load payment form: ' + (error.message || 'Unknown error');
        statusDiv.className = 'error';
    }
}

// Tap-to-pay payment (placeholder for iOS)
function tapPayment() {
    console.log('Tap-to-pay selected');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const statusDiv = document.getElementById('status');
    const driverName = document.getElementById('driverName').value;

    paymentOptionsScreen.style.display = 'none';
    receiptScreen.style.display = 'block';
    statusDiv.innerText = 'Tap-to-pay processed (mocked for web)';
    console.log('Tap-to-pay mocked - awaiting iOS implementation');

    // Set tip labels and ride info
    setTipLabels(window.baseAmount);
    updateTipButtonStyles(); // Add this
    document.getElementById('driverInfo').innerText = `Driver: ${driverName}`;
    document.getElementById('rideInfo').innerText = `Amount: $${window.baseAmount.toFixed(2)} - ${window.paymentNote}`;
}

// Add tip and update amount
function addTip(percentage) {
    const amountInput = document.getElementById('amount');
    const statusDiv = document.getElementById('status');
    let baseAmount = parseFloat(amountInput.value) || window.baseAmount; // Fallback to baseAmount
    let tipAmount = 0;

    // Undo if same button pressed again
    if (selectedTip === percentage) {
        selectedTip = null;
        tipAmount = 0;
        amountInput.value = window.baseAmount.toFixed(2);
        statusDiv.innerText = 'Tip removed. Total: $' + amountInput.value;
        updateTipButtonStyles();
        return;
    }

    // Set new tip
    if (percentage === 'custom') {
        const customTip = prompt('Enter tip amount (e.g., 5.00)');
        if (customTip && !isNaN(customTip) && customTip >= 0) {
            tipAmount = parseFloat(customTip);
        } else {
            statusDiv.innerText = 'Invalid tip amount';
            statusDiv.className = 'error';
            return;
        }
    } else {
        tipAmount = baseAmount * (percentage / 100);
    }

    const totalAmount = (baseAmount + tipAmount).toFixed(2);
    amountInput.value = totalAmount;
    statusDiv.innerText = `Tip added: $${tipAmount.toFixed(2)}. New total: $${totalAmount}`;
    selectedTip = percentage;
    updateTipButtonStyles();
}

function updateTipButtonStyles() {
    const buttons = ['tip15', 'tip20', 'tip25', 'tipCustom'];
    buttons.forEach(id => {
        const button = document.getElementById(id);
        if (selectedTip === (id === 'tipCustom' ? 'custom' : parseInt(id.replace('tip', '')))) {
            button.classList.add('selected');
        } else {
            button.classList.remove('selected');
        }
    });
}

// Finalize payment, save history, send admin email, reset
async function finishPayment() {
    const amountInput = document.getElementById('amount');
    const driverNameInput = document.getElementById('driverName');
    const driverEmailInput = document.getElementById('driverEmail');
    const statusDiv = document.getElementById('status');
    const paymentScreen = document.getElementById('paymentScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const chargeScreen = document.getElementById('chargeScreen');
    const manualCardScreen = document.getElementById('manualCardScreen');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const amount = parseFloat(amountInput.value);
    const driverName = driverNameInput.value;
    const driverEmail = driverEmailInput.value;
    const baseFare = window.baseAmount;
    const tipAmount = (amount - baseFare).toFixed(2);
    const driverPay = (baseFare * 0.72 + parseFloat(tipAmount)).toFixed(2);

    statusDiv.innerText = 'Processing total payment...';
    try {
        if (!window.card) {
            throw new Error('Card not initialized');
        }
        console.log('Tokenizing total payment (base + tip): $' + amount);
        const result = await window.card.tokenize();
        if (result.status !== 'OK') {
            throw new Error(result.errors?.[0]?.message || 'Tokenization failed');
        }
        const token = result.token;
        console.log('Total payment token:', token);
        window.paymentToken = token;

        const chargeResponse = await fetch('/charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, amount })
        });
        if (!chargeResponse.ok) {
            throw new Error(`Charge failed: ${chargeResponse.statusText}`);
        }
        const chargeResult = await chargeResponse.json();
        if (chargeResult.status !== 'success') {
            throw new Error(chargeResult.message || 'Payment failed on server');
        }
        statusDiv.innerText = 'Payment processed! Payment ID: ' + chargeResult.paymentId;
        statusDiv.className = 'success';

        const ride = {
            dateTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
            fare: baseFare.toFixed(2),
            tip: tipAmount,
            total: amount.toFixed(2),
            driverPay: driverPay,
            startAddress: document.getElementById('startAddress').value,
            destination: document.getElementById('destination').value,
            distance: ((endLocation && startLocation) ? (google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(startLocation.lat, startLocation.lng),
                new google.maps.LatLng(endLocation.lat, endLocation.lng)
            ) / 1609.34).toFixed(1) : 'N/A'),
            time: ((endTime && startTime) ? ((endTime - startTime) / 60000).toFixed(1) : 'N/A'),
            waitCost: waitCost.toFixed(2)
        };
        let history = JSON.parse(localStorage.getItem('rideHistory') || '[]');
        history.push(ride);
        localStorage.setItem('rideHistory', JSON.stringify(history));

        const dateTime = ride.dateTime;
        const distance = ride.distance;
        const time = ride.time;
        const fixedFare = (distance * 1.60 + time * 0.41).toFixed(2);
        const chargedAmount = amount.toFixed(2);

        const adminSubject = `MinnDrive Ride Review - ${dateTime}`;
        const adminBody = `
        MinnDrive Ride Review
        Driver: ${driverName}
        Start Address: ${ride.startAddress}
        Destination: ${ride.destination}
        Date/Time: ${dateTime}
        Ride Breakdown:
        - Distance: ${distance} mi ($1.60/mi = $${(distance * 1.60).toFixed(2)})
        - Time: ${time} min ($0.41/min = $${(time * 0.41).toFixed(2)})
        - Fixed Fare Total: $${fixedFare}
        - Wait Cost: $${ride.waitCost}
        - Actual Amount Charged: $${chargedAmount}
        - Driver Pay: $${driverPay} (72% Fare + 100% Tip)
        `.trim();

        const driverSubject = `MinnDrive Receipt - ${dateTime}`;
        const driverBody = `
        MinnDrive Receipt
        3333 Lake Shore Ct, Chaska, MN 55318
        Date/Time: ${dateTime}
        Driver: ${driverName}
        Ride Details:
        - Start: ${ride.startAddress}
        - Destination: ${ride.destination}
        - Fare: $${baseFare.toFixed(2)}
        - Wait Cost: $${ride.waitCost}
        - Tip: $${tipAmount}
        - Total: $${chargedAmount}
        Thank you for choosing MinnDrive!
        `.trim();

        await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminSubject,
                adminBody,
                driverSubject,
                driverBody,
                driverEmail
            })
        }).then(response => response.json())
          .then(data => {
              if (data.status === 'success') {
                  console.log('Emails sent successfully');
              } else {
                  console.error('Email send failed:', data.message);
              }
          });

        statusDiv.innerText = 'Payment Successful! Total: $' + chargedAmount;
        statusDiv.className = 'success';

        setTimeout(() => {
            console.log('Resetting UI to paymentScreen');
            paymentScreen.style.display = 'block';
            chargeScreen.style.display = 'none';
            receiptScreen.style.display = 'none';
            manualCardScreen.style.display = 'none';
            paymentOptionsScreen.style.display = 'none';
            amountInput.value = '';
            document.getElementById('startAddress').value = '';
            document.getElementById('destination').value = '';
            document.getElementById('clientPhone').value = '';
            document.getElementById('onOurWayBtn').style.display = 'block';
            document.getElementById('arriveBtn').style.display = 'none';
            document.getElementById('startRideBtn').style.display = 'none';
            document.getElementById('finishRideBtn').style.display = 'none';
            document.getElementById('navOptions').style.display = 'none';
            map.setCenter({ lat: 44.8549, lng: -93.4708 });
            directionsRenderer.set('directions', null);
            statusDiv.innerText = '';
            console.log('UI reset complete');
        }, 10000);
    } catch (error) {
        console.error('Payment error:', error.message || error);
        statusDiv.innerText = 'Payment error: ' + (error.message || 'Unknown error');
        statusDiv.className = 'error';
    }
}

function toggleMenu(event) {
    const menu = document.getElementById('menuDropdown');
    event.stopPropagation();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

document.addEventListener('click', function(event) {
    const menu = document.getElementById('menuDropdown');
    const menuButton = document.getElementById('hamburgerBtn');
    if (menu && menu.style.display === 'block' && !menu.contains(event.target) && !menuButton.contains(event.target)) {
        menu.style.display = 'none';
    }
});

/// Show ride history
function showHistory() {
    const historyModal = document.getElementById('historyModal');
    const historyList = document.getElementById('historyList');
    const history = JSON.parse(localStorage.getItem('rideHistory') || '[]');

    if (history.length === 0) {
        historyList.innerHTML = '<p>No rides yet.</p>';
    } else {
        historyList.innerHTML = history.map(ride => `
            <p>
                ${ride.dateTime}<br>
                Start: ${ride.startAddress}<br>
                Destination: ${ride.destination}<br>
                Fare: $${ride.fare} | Tip: $${ride.tip} | Total: $${ride.total}<br>
                Note: ${ride.note}<br>
                Driver Pay: $${ride.driverPay}
            </p>
        `).join('');
    }
    historyModal.style.display = 'flex';
}

// Hide ride history
function hideHistory() {
    document.getElementById('historyModal').style.display = 'none';
}