let map, directionsService, directionsRenderer;
let startLocation, endLocation, startTime, endTime;
let squarePayments;
let waitStartTime;
let waitCost = 0;
let selectedTip = null; // Add at top, after other globals like waitCost

// Helper function to set tip labels
function setTipLabels(baseAmount) {
    document.getElementById('tip15').innerText = `15% - $${(baseAmount * 0.15).toFixed(2)}`;
    document.getElementById('tip20').innerText = `20% - $${(baseAmount * 0.20).toFixed(2)}`;
    document.getElementById('tip25').innerText = `25% - $${(baseAmount * 0.25).toFixed(2)}`;
    document.getElementById('tipCustom').innerText = 'Custom';
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
    const startAddress = document.getElementById('startAddress').value;
    const destination = document.getElementById('destination').value;
    const clientPhone = document.getElementById('clientPhone').value;
    const driverName = document.getElementById('driverName').value;

    if (!startAddress || !destination || !clientPhone) {
        document.getElementById('status').innerText = 'Please enter start address, destination, and client phone.';
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
                    const duration = result.routes[0].legs[0].duration.value / 60; // Minutes
                    const eta = new Date(startTime.getTime() + duration * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    // Use server endpoint instead of direct Twilio API call
                    fetch('/api/send-sms', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            to: clientPhone,
                            message: `Your driver, ${driverName}, is on the way from their location. Estimated ETA to your pickup: ${eta}`
                        })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.status === 'success') {
                            console.log('SMS sent:', data);
                        } else {
                            console.error('SMS failed:', data.message);
                        }
                    })
                    .catch(error => console.error('SMS failed:', error));

                    document.getElementById('status').innerText = `On our way to pickup. ETA: ${eta}`;
                    document.getElementById('onOurWayBtn').style.display = 'none';
                    document.getElementById('arriveBtn').style.display = 'block';
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
    const startAddress = document.getElementById('startAddress').value;
    const destination = document.getElementById('destination').value;
    if (!startAddress || !destination) {
        document.getElementById('status').innerText = 'Please enter start address and destination.';
        return;
    }
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            startLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            map.setCenter(startLocation);
            document.getElementById('status').innerText = 'Arrived at pickup. Waiting...';
            document.getElementById('arriveBtn').style.display = 'none';
            document.getElementById('startRideBtn').style.display = 'block'; // Show Start Ride
            waitStartTime = new Date(); // Start wait clock
        }, () => {
            document.getElementById('status').innerText = 'Geolocation failed.';
        });
    } else {
        document.getElementById('status').innerText = 'Geolocation not supported.';
    }
}

function startRide() {
    if (!waitStartTime) {
        document.getElementById('status').innerText = 'Wait time not started.';
        return;
    }
    const waitEndTime = new Date();
    const waitTimeMs = waitEndTime - waitStartTime; // Wait time in milliseconds
    const waitTimeMin = waitTimeMs / 60000; // Convert to minutes
    waitCost = waitTimeMin > 15 ? (waitTimeMin - 15) * 0.50 : 0; // $0.50/min after 15 min
    document.getElementById('status').innerText = waitCost > 0 
        ? `Wait time cost: $${waitCost.toFixed(2)}. Starting ride...`
        : 'No wait time cost. Starting ride...';
    document.getElementById('startRideBtn').style.display = 'none';
    document.getElementById('finishRideBtn').style.display = 'block';
    startTime = new Date(); // Reset startTime for ride duration
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

async function initializeSquare() {
    try {
        const response = await fetch('/config');
        const config = await response.json();
        if (!window.Square) {
            throw new Error('Square SDK not loaded - check script in index.html');
        }
        squarePayments = await window.Square.payments(config.squareAppId, 'L2TZNBER8J28H');
        console.log('Square Payments initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Square:', error);
    }
}

window.onload = function() {
    const driverNameInput = document.getElementById('driverName');
    const driverEmailInput = document.getElementById('driverEmail');
    let savedDriver = localStorage.getItem('defaultDriver');
    let savedEmail = localStorage.getItem('driverEmail');
    let savedPhone = localStorage.getItem('driverPhone');

    if (!savedDriver || !savedEmail || !savedPhone) {
        savedDriver = prompt('What’s your name? (e.g., Darwin Belleza)');
        if (savedDriver) {
            savedDriver = capitalizeName(savedDriver);
            localStorage.setItem('defaultDriver', savedDriver);
        }
        savedEmail = prompt('What’s your email? (e.g., darwin@example.com)');
        if (savedEmail) {
            localStorage.setItem('driverEmail', savedEmail);
        }
        savedPhone = prompt('What’s your phone number? (e.g., +12345678900)');
        if (savedPhone) {
            localStorage.setItem('driverPhone', savedPhone);
        }
    }

    driverNameInput.value = savedDriver || '';
    driverEmailInput.value = savedEmail || '';
    console.log('Calling initializeSquare');
    initializeSquare().then(() => {
        console.log('Square initialized after profile setup');
    }).catch(error => {
        console.log('Initialization failed:', error.message || error);
    });
};

// Update profile
function updateProfile() {
    const driverNameInput = document.getElementById('driverName');
    const driverEmailInput = document.getElementById('driverEmail');
    if (!driverNameInput || !driverEmailInput) {
        console.error('Profile inputs not found');
        return;
    }

    const newName = prompt('Enter your name:', driverNameInput.value);
    const newEmail = prompt('Enter your email:', driverEmailInput.value);
    const newPhone = prompt('Enter your phone number:', localStorage.getItem('driverPhone') || '');

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
}


// Go directly to $5 increment payment screen without rider info
function chargeNow() {
    console.log('Charge Now clicked');
    const paymentScreen = document.getElementById('paymentScreen');
    const chargeScreen = document.getElementById('chargeScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const statusDiv = document.getElementById('status');
    const amountInput = document.getElementById('amount');
    const noteInput = document.getElementById('note');

    // Hide other screens and show charge screen
    paymentScreen.style.display = 'none';
    receiptScreen.style.display = 'none';
    chargeScreen.style.display = 'block';

    // Clear rider info only, keep driver info
    amountInput.value = '';
    noteInput.value = '';
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
// Set amount from price buttons
function setAmount(price) {
    const amountInput = document.getElementById('amount');
    if (price === 'variable') {
        const customAmount = prompt('Enter custom amount (e.g., 27.50)');
        if (customAmount && !isNaN(customAmount) && customAmount > 0) {
            amountInput.value = parseFloat(customAmount).toFixed(2);
        }
    } else {
        amountInput.value = price.toFixed(2);
    }
    document.getElementById('status').innerText = `Amount set to $${amountInput.value}`;
}

// Trigger Square payment with preset amount
function triggerPayment() {
    const amountInput = document.getElementById('amount');
    const noteInput = document.getElementById('note');
    const driverNameInput = document.getElementById('driverName');
    const statusDiv = document.getElementById('status');
    const chargeScreen = document.getElementById('chargeScreen');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const amount = amountInput.value;
    const driverName = driverNameInput.value;
    const note = noteInput.value || 'Ride Payment';

    if (!amount || amount <= 0 || isNaN(amount)) {
        statusDiv.innerText = 'Please select a valid amount';
        statusDiv.className = 'error';
        return;
    }
    if (!driverName) {
        statusDiv.innerText = 'Driver name not set';
        statusDiv.className = 'error';
        return;
    }

    console.log('Showing payment options with amount:', amount);
    window.baseAmount = parseFloat(amount);
    window.paymentNote = note;
    chargeScreen.style.display = 'none';
    paymentOptionsScreen.style.display = 'block';
    statusDiv.innerText = 'Choose payment method';
    setTipLabels(window.baseAmount); // Add here for preview
}

// Manual credit card payment
async function manualPayment() {
    console.log('Manual payment selected');
    const paymentOptionsScreen = document.getElementById('paymentOptionsScreen');
    const manualCardScreen = document.getElementById('manualCardScreen');
    const receiptScreen = document.getElementById('receiptScreen');
    const statusDiv = document.getElementById('status');
    const driverName = document.getElementById('driverName').value;
    const cardContainer = document.getElementById('card-container');

    paymentOptionsScreen.style.display = 'none';
    manualCardScreen.style.display = 'block';
    statusDiv.innerText = 'Loading card form...';

    try {
        if (!squarePayments) {
            throw new Error('Square payments not initialized');
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
    const noteInput = document.getElementById('note');
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
    const note = noteInput.value || 'Ride Payment';
    const baseFare = window.baseAmount;
    const tipAmount = (amount - baseFare).toFixed(2);
    const fullNote = tipAmount > 0 ? `Driver: ${driverName} - ${note} + Tip: $${tipAmount}` : `Driver: ${driverName} - ${note}`;
    const driverPay = (baseFare * 0.72 + parseFloat(tipAmount)).toFixed(2);

    statusDiv.innerText = 'Processing total payment...';
    try {
        if (!window.card) {
            throw new Error('Card not initialized');
        }
        console.log('Tokenizing total payment (base + tip): $' + amount);
        const result = await window.card.tokenize();
        if (result.status === 'OK') {
            const token = result.token;
            console.log('Total payment token:', token);
            window.paymentToken = token;
            statusDiv.innerText = 'Payment processed!';
            statusDiv.className = 'success';
        } else {
            statusDiv.innerText = 'Payment failed: ' + (result.errors?.[0]?.message || 'Unknown error');
            statusDiv.className = 'error';
            return;
        }
    } catch (error) {
        console.error('Payment error:', error.message || error);
        statusDiv.innerText = 'Payment error: ' + (error.message || 'Unknown error');
        statusDiv.className = 'error';
        return;
    }

    const ride = {
        dateTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
        fare: window.baseAmount.toFixed(2),
        tip: tipAmount,
        total: amount.toFixed(2),
        note: note,
        driverPay: driverPay,
        startAddress: document.getElementById('startAddress').value,
        destination: document.getElementById('destination').value,
        distance: ((endLocation && startLocation) ? (google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(startLocation.lat, startLocation.lng),
            new google.maps.LatLng(endLocation.lat, endLocation.lng)
        ) / 1609.34).toFixed(1) : 'N/A'),
        time: ((endTime && startTime) ? ((endTime - startTime) / 60000).toFixed(1) : 'N/A'),
        waitCost: waitCost.toFixed(2) // Add this line
    };
    let history = JSON.parse(localStorage.getItem('rideHistory') || '[]');
    history.push(ride);
    localStorage.setItem('rideHistory', JSON.stringify(history));

    const dateTime = ride.dateTime;
    const distance = ride.distance;
    const time = ride.time;
    const fixedFare = (distance * 1.60 + time * 0.41).toFixed(2);
    const chargedAmount = amount.toFixed(2);

    // Admin email
    const adminEmail = 'minndriveairport@gmail.com';
    const subject = encodeURIComponent(`MinnDrive Ride Review - ${dateTime}`);
    const body = encodeURIComponent(`
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
- Note: ${note}
    `.trim());
    window.open(`mailto:${adminEmail}?subject=${subject}&body=${body}`, '_blank');

    // Driver receipt email
    const receipt = `
MinnDrive Receipt
3333 Lake Shore Ct, Chaska, MN 55318
Date/Time: ${dateTime}
Driver: ${driverName}

Ride Details:
- Start: ${ride.startAddress}
- Destination: ${ride.destination}
- Fare: $${baseFare.toFixed(2)}
- Tip: $${tipAmount}
- Total: $${chargedAmount}

Thank you for choosing MinnDrive!
    `.trim();
    const driverSubject = encodeURIComponent(`MinnDrive Receipt - ${dateTime}`);
    const driverBody = encodeURIComponent(receipt);
    window.open(`mailto:${driverEmail}?subject=${driverSubject}&body=${driverBody}`, '_blank');

    statusDiv.innerText = 'Payment Successful! Total: $' + chargedAmount;
    statusDiv.className = 'success';

    // Reset UI after 10 seconds
    setTimeout(() => {
        console.log('Resetting UI to paymentScreen');
        paymentScreen.style.display = 'block';
        chargeScreen.style.display = 'none';
        receiptScreen.style.display = 'none';
        manualCardScreen.style.display = 'none';
        paymentOptionsScreen.style.display = 'none';
        amountInput.value = '';
        noteInput.value = '';
        document.getElementById('startAddress').value = '';
        document.getElementById('destination').value = '';
        document.getElementById('clientPhone').value = '';
        document.getElementById('onOurWayBtn').style.display = 'block';
        document.getElementById('arriveBtn').style.display = 'none';
        document.getElementById('finishRideBtn').style.display = 'none';
        map.setCenter({ lat: 44.8549, lng: -93.4708 });
        directionsRenderer.set('directions', null);
        statusDiv.innerText = '';
        console.log('UI reset complete');
    }, 10000); // 10 seconds delay
}

function toggleMenu(event) {
    const menu = document.getElementById('menuDropdown');
    event.stopPropagation();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

document.addEventListener('click', function(event) {
    const menu = document.getElementById('menuDropdown');
    const menuButton = document.querySelector('.menu-button');
    if (menu.style.display === 'block' && !menu.contains(event.target) && !menuButton.contains(event.target)) {
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