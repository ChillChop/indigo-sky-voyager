
import { LightningElement, track, wire } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import stripeJs from '@salesforce/resourceUrl/stripeJs';

import searchFlights from '@salesforce/apex/FlightBookingService.searchFlights';
import createBooking from '@salesforce/apex/FlightBookingService.createBooking';
import addPassengers from '@salesforce/apex/FlightBookingService.addPassengers';
import processPayment from '@salesforce/apex/FlightBookingService.processPayment';
import generateTicket from '@salesforce/apex/FlightBookingService.generateTicket';

import createPaymentIntent from '@salesforce/apex/StripeService.createPaymentIntent';
import confirmPaymentSuccess from '@salesforce/apex/StripeService.confirmPaymentSuccess';

export default class FlightBooking extends LightningElement {
    // Step tracking
    @track currentStep = 'search';
    
    // Loading and error states
    @track isLoading = false;
    @track errorMessage = '';
    
    // Search form data
    @track tripType = 'oneWay';
    @track origin = '';
    @track destination = '';
    @track departureDate = '';
    @track returnDate = '';
    @track adults = 1;
    @track children = 0;
    @track infants = 0;
    
    // Flight selection data
    @track availableFlights = [];
    @track priceFilter = 1000;
    @track selectedSortOption = 'price';
    @track selectedAirlines = ['indigo', 'other'];
    @track selectedFlight = null;
    
    // Seat selection data
    @track seatRows = [];
    @track selectedSeats = [];
    @track requiredSeats = 1;
    
    // Passenger data
    @track passengerForms = [];
    
    // Payment data
    @track stripe;
    @track cardElement;
    @track paymentIntent;
    @track termsAccepted = false;
    @track showTerms = false;
    @track paymentError = '';
    @track totalAmount = 0;
    @track baseFareTotal = 0;
    @track taxesAndFees = 0;
    
    // Booking confirmation data
    @track bookingReference = '';
    @track bookingId = '';
    
    connectedCallback() {
        // Set today's date as default
        const today = new Date();
        this.today = today.toISOString().split('T')[0];
        this.departureDate = this.today;
        
        // Set tomorrow as default return date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        this.returnDate = tomorrow.toISOString().split('T')[0];
        
        // Load Stripe.js
        loadScript(this, stripeJs)
            .then(() => {
                this.initializeStripe();
            })
            .catch(error => {
                console.error('Error loading Stripe.js', error);
                this.errorMessage = 'Failed to load payment processor. Please try again later.';
            });
    }
    
    // Initialize Stripe
    initializeStripe() {
        if (window.Stripe) {
            // Replace with your Stripe publishable key
            this.stripe = window.Stripe('YOUR_STRIPE_PUBLISHABLE_KEY');
        }
    }
    
    // Step visibility getters
    get isSearchStep() {
        return this.currentStep === 'search';
    }
    
    get isSelectStep() {
        return this.currentStep === 'select';
    }
    
    get isSeatsStep() {
        return this.currentStep === 'seats';
    }
    
    get isPassengersStep() {
        return this.currentStep === 'passengers';
    }
    
    get isPaymentStep() {
        return this.currentStep === 'payment';
    }
    
    get isConfirmationStep() {
        return this.currentStep === 'confirmation';
    }
    
    // Convenience getters
    get isOneWay() {
        return this.tripType === 'oneWay';
    }
    
    get isRoundTrip() {
        return this.tripType === 'roundTrip';
    }
    
    get totalPassengers() {
        return parseInt(this.adults) + parseInt(this.children) + parseInt(this.infants);
    }
    
    get noFlightsAvailable() {
        return this.availableFlights.length === 0 && !this.isLoading;
    }
    
    get noSeatsSelected() {
        return this.selectedSeats.length === 0;
    }
    
    get insufficientSeatsSelected() {
        return this.selectedSeats.length < this.requiredSeats;
    }
    
    get invalidPassengerData() {
        if (!this.passengerForms || this.passengerForms.length === 0) return true;
        
        for (const passenger of this.passengerForms) {
            if (!passenger.name || !passenger.email || !passenger.phone) {
                return true;
            }
            
            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(passenger.email)) {
                return true;
            }
        }
        
        return false;
    }
    
    get selectedSeatsString() {
        return this.selectedSeats.join(', ');
    }
    
    get paymentButtonDisabled() {
        return !this.termsAccepted || !this.stripe || !this.cardElement;
    }
    
    get mainPassengerEmail() {
        return this.passengerForms.length > 0 ? this.passengerForms[0].email : '';
    }
    
    // Helper method to determine step class
    getStepClass(step) {
        const currentIndex = this.getStepIndex(this.currentStep);
        const stepIndex = this.getStepIndex(step);
        
        if (step === this.currentStep) {
            return 'step active';
        } else if (stepIndex < currentIndex) {
            return 'step completed';
        } else {
            return 'step';
        }
    }
    
    getStepIndex(step) {
        const steps = ['search', 'select', 'seats', 'passengers', 'payment', 'confirmation'];
        return steps.indexOf(step);
    }
    
    // Event handlers for search form
    handleTripTypeChange(event) {
        this.tripType = event.target.value;
    }
    
    handleOriginChange(event) {
        this.origin = event.target.value;
    }
    
    handleDestinationChange(event) {
        this.destination = event.target.value;
    }
    
    handleDepartureDateChange(event) {
        this.departureDate = event.target.value;
        
        // Ensure return date is after departure date
        if (this.isRoundTrip && this.returnDate < this.departureDate) {
            this.returnDate = this.departureDate;
        }
    }
    
    handleReturnDateChange(event) {
        this.returnDate = event.target.value;
    }
    
    handleAdultsChange(event) {
        this.adults = parseInt(event.target.value);
        this.updateRequiredSeats();
    }
    
    handleChildrenChange(event) {
        this.children = parseInt(event.target.value);
        this.updateRequiredSeats();
    }
    
    handleInfantsChange(event) {
        this.infants = parseInt(event.target.value);
        // Infants don't require seats as they sit on adults' laps
        this.updateRequiredSeats();
    }
    
    updateRequiredSeats() {
        this.requiredSeats = parseInt(this.adults) + parseInt(this.children);
    }
    
    // Flight search handler
    handleSearchFlights() {
        // Validate form
        if (!this.origin || !this.destination || !this.departureDate) {
            this.errorMessage = 'Please fill all required fields.';
            return;
        }
        
        if (this.origin === this.destination) {
            this.errorMessage = 'Origin and destination cannot be the same.';
            return;
        }
        
        this.errorMessage = '';
        this.isLoading = true;
        
        // Call Apex to search flights
        searchFlights({
            origin: this.origin,
            destination: this.destination,
            departureDate: this.departureDate,
            adults: this.adults,
            children: this.children,
            infants: this.infants
        })
        .then(result => {
            this.processFlightResults(result);
            this.currentStep = 'select';
            this.isLoading = false;
        })
        .catch(error => {
            console.error('Error searching flights', error);
            this.errorMessage = 'Failed to search flights. ' + (error.body ? error.body.message : error.message);
            this.isLoading = false;
        });
    }
    
    // Process flight search results
    processFlightResults(results) {
        try {
            if (!results || !results.data) {
                this.availableFlights = [];
                return;
            }
            
            this.availableFlights = results.data.map(flight => {
                // Extract flight details from the complex JSON structure
                const itinerary = flight.itineraries[0];
                const firstSegment = itinerary.segments[0];
                const lastSegment = itinerary.segments[itinerary.segments.length - 1];
                
                const departureTime = new Date(firstSegment.departure.at);
                const arrivalTime = new Date(lastSegment.arrival.at);
                const durationMinutes = (arrivalTime - departureTime) / (1000 * 60);
                const hours = Math.floor(durationMinutes / 60);
                const minutes = durationMinutes % 60;
                
                return {
                    id: flight.id,
                    flightNumber: firstSegment.number,
                    origin: firstSegment.departure.iataCode,
                    destination: lastSegment.arrival.iataCode,
                    departureDate: this.formatDate(departureTime),
                    departureTime: this.formatTime(departureTime),
                    arrivalTime: this.formatTime(arrivalTime),
                    duration: `${hours}h ${minutes}m`,
                    stops: itinerary.segments.length - 1,
                    price: flight.price.grandTotal,
                    basePrice: flight.price.base,
                    airline: firstSegment.carrierCode,
                    departureDateTime: departureTime,
                    arrivalDateTime: arrivalTime
                };
            });
            
            // Apply default sorting (price)
            this.sortFlights('price');
        } catch (error) {
            console.error('Error processing flight results', error);
            this.availableFlights = [];
        }
    }
    
    // Format helpers
    formatDate(date) {
        return date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    }
    
    formatTime(date) {
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
        });
    }
    
    // Flight filters and sorting
    handlePriceFilterChange(event) {
        this.priceFilter = event.target.value;
        this.applyFilters();
    }
    
    handleAirlineFilterChange(event) {
        const airline = event.target.value;
        const checked = event.target.checked;
        
        if (checked) {
            if (!this.selectedAirlines.includes(airline)) {
                this.selectedAirlines.push(airline);
            }
        } else {
            this.selectedAirlines = this.selectedAirlines.filter(item => item !== airline);
        }
        
        this.applyFilters();
    }
    
    handleSortChange(event) {
        this.selectedSortOption = event.target.value;
        this.sortFlights(this.selectedSortOption);
    }
    
    applyFilters() {
        // Apply all filters and sorting
        const maxPrice = parseFloat(this.priceFilter);
        
        // First, filter by selected criteria
        this.availableFlights = this.availableFlights.filter(flight => {
            const price = parseFloat(flight.price);
            const airlineMatches = this.selectedAirlines.includes(flight.airline.toLowerCase()) || 
                                  (flight.airline.toLowerCase() !== 'indigo' && this.selectedAirlines.includes('other'));
            
            return price <= maxPrice && airlineMatches;
        });
        
        // Then apply current sorting
        this.sortFlights(this.selectedSortOption);
    }
    
    sortFlights(sortBy) {
        switch(sortBy) {
            case 'price':
                this.availableFlights.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
                break;
            case 'duration':
                // Sort by flight duration (assuming duration is stored in minutes)
                this.availableFlights.sort((a, b) => {
                    const aDuration = (a.arrivalDateTime - a.departureDateTime) / (1000 * 60);
                    const bDuration = (b.arrivalDateTime - b.departureDateTime) / (1000 * 60);
                    return aDuration - bDuration;
                });
                break;
            case 'departure':
                // Sort by departure time
                this.availableFlights.sort((a, b) => a.departureDateTime - b.departureDateTime);
                break;
            default:
                break;
        }
    }
    
    // Flight selection handler
    handleFlightSelect(event) {
        const flightId = event.currentTarget.dataset.id;
        this.selectedFlight = this.availableFlights.find(flight => flight.id === flightId);
        
        if (this.selectedFlight) {
            this.generateSeatMap();
            this.currentStep = 'seats';
        }
    }
    
    // Generate a seat map for the selected flight
    generateSeatMap() {
        this.seatRows = [];
        
        // Create a 30-row airplane with 6 seats per row (3-3 configuration)
        for (let i = 1; i <= 30; i++) {
            const row = {
                rowNum: i,
                seats: []
            };
            
            // A, B, C seats (left side)
            ['A', 'B', 'C'].forEach(letter => {
                const seatId = `${i}${letter}`;
                row.seats.push({
                    id: seatId,
                    label: letter,
                    isOccupied: this.getRandomOccupied(),
                    isSelected: false,
                    isAisle: false,
                    className: this.getRandomOccupied() ? 'seat unavailable' : 'seat available'
                });
            });
            
            // Add aisle indicator
            row.seats.push({
                id: `aisle-${i}`,
                isAisle: true
            });
            
            // D, E, F seats (right side)
            ['D', 'E', 'F'].forEach(letter => {
                const seatId = `${i}${letter}`;
                row.seats.push({
                    id: seatId,
                    label: letter,
                    isOccupied: this.getRandomOccupied(),
                    isSelected: false,
                    isAisle: false,
                    className: this.getRandomOccupied() ? 'seat unavailable' : 'seat available'
                });
            });
            
            this.seatRows.push(row);
        }
    }
    
    // Helper to randomly determine if a seat is occupied
    getRandomOccupied() {
        return Math.random() < 0.3; // 30% chance of being occupied
    }
    
    // Seat selection handler
    handleSeatClick(event) {
        const seatId = event.currentTarget.dataset.seatId;
        const seat = this.findSeat(seatId);
        
        if (!seat || seat.className.includes('unavailable')) {
            return; // Seat is unavailable
        }
        
        if (seat.className.includes('selected')) {
            // Deselect the seat
            seat.className = 'seat available';
            this.selectedSeats = this.selectedSeats.filter(id => id !== seatId);
        } else {
            // Check if we already have enough seats selected
            if (this.selectedSeats.length >= this.requiredSeats) {
                // Replace the oldest selection
                const oldestSeatId = this.selectedSeats.shift();
                const oldestSeat = this.findSeat(oldestSeatId);
                if (oldestSeat) {
                    oldestSeat.className = 'seat available';
                }
            }
            
            // Select the new seat
            seat.className = 'seat selected';
            this.selectedSeats.push(seatId);
        }
    }
    
    // Helper to find a seat by ID
    findSeat(seatId) {
        for (const row of this.seatRows) {
            for (const seat of row.seats) {
                if (seat.id === seatId) {
                    return seat;
                }
            }
        }
        return null;
    }
    
    // Navigation handlers
    handleBackToFlights() {
        this.currentStep = 'select';
    }
    
    handleContinueToPassengers() {
        if (this.selectedSeats.length < this.requiredSeats) {
            this.errorMessage = `Please select ${this.requiredSeats} seats to continue.`;
            return;
        }
        
        // Generate passenger forms based on the number of adults and children
        this.generatePassengerForms();
        this.currentStep = 'passengers';
    }
    
    generatePassengerForms() {
        this.passengerForms = [];
        
        // Create forms for adults
        for (let i = 0; i < this.adults; i++) {
            this.passengerForms.push({
                id: `adult-${i}`,
                type: 'adult',
                name: '',
                email: '',
                phone: '',
                mealPreference: 'regular'
            });
        }
        
        // Create forms for children
        for (let i = 0; i < this.children; i++) {
            this.passengerForms.push({
                id: `child-${i}`,
                type: 'child',
                name: '',
                email: '',
                phone: '',
                mealPreference: 'regular'
            });
        }
    }
    
    handlePassengerChange(event) {
        const index = parseInt(event.target.dataset.index);
        const field = event.target.dataset.field;
        const value = event.target.value;
        
        if (this.passengerForms[index]) {
            this.passengerForms[index][field] = value;
        }
    }
    
    handleBackToSeats() {
        this.currentStep = 'seats';
    }
    
    handleContinueToPayment() {
        if (this.invalidPassengerData) {
            this.errorMessage = 'Please fill in all required passenger information.';
            return;
        }
        
        this.errorMessage = '';
        
        // Calculate total amount
        this.calculateTotalAmount();
        
        // Create payment intent
        this.createStripePaymentIntent();
        
        this.currentStep = 'payment';
        
        // Initialize card element
        this.initializeCardElement();
    }
    
    calculateTotalAmount() {
        // Base fare calculation
        const basePrice = parseFloat(this.selectedFlight.basePrice);
        this.baseFareTotal = (basePrice * this.totalPassengers).toFixed(2);
        
        // Taxes and fees (typically 10-20% of base fare)
        this.taxesAndFees = (this.baseFareTotal * 0.15).toFixed(2);
        
        // Total amount
        this.totalAmount = (parseFloat(this.baseFareTotal) + parseFloat(this.taxesAndFees)).toFixed(2);
    }
    
    initializeCardElement() {
        if (this.stripe) {
            // Clear existing elements if any
            const container = this.template.querySelector('.stripe-card-element');
            if (container) {
                container.innerHTML = '';
                
                const elements = this.stripe.elements();
                
                // Create card element
                this.cardElement = elements.create('card', {
                    style: {
                        base: {
                            color: '#32325d',
                            fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                            fontSmoothing: 'antialiased',
                            fontSize: '16px',
                            '::placeholder': {
                                color: '#aab7c4'
                            }
                        },
                        invalid: {
                            color: '#fa755a',
                            iconColor: '#fa755a'
                        }
                    }
                });
                
                // Mount the card element
                this.cardElement.mount(container);
                
                // Add event listener for errors
                this.cardElement.on('change', (event) => {
                    if (event.error) {
                        this.paymentError = event.error.message;
                    } else {
                        this.paymentError = '';
                    }
                });
            }
        }
    }
    
    createStripePaymentIntent() {
        this.isLoading = true;
        
        createPaymentIntent({
            amount: this.totalAmount,
            currency: 'usd'
        })
        .then(result => {
            this.paymentIntent = result;
            this.isLoading = false;
        })
        .catch(error => {
            console.error('Error creating payment intent', error);
            this.paymentError = 'Failed to initialize payment. Please try again.';
            this.isLoading = false;
        });
    }
    
    handleBackToPassengers() {
        this.currentStep = 'passengers';
    }
    
    showTermsModal() {
        this.showTerms = true;
    }
    
    closeTermsModal() {
        this.showTerms = false;
    }
    
    acceptTerms() {
        this.termsAccepted = true;
        this.closeTermsModal();
    }
    
    handleTermsChange(event) {
        this.termsAccepted = event.target.checked;
    }
    
    handlePayment() {
        if (!this.stripe || !this.cardElement || !this.paymentIntent) {
            this.paymentError = 'Payment system not initialized properly.';
            return;
        }
        
        if (!this.termsAccepted) {
            this.paymentError = 'Please accept the terms and conditions.';
            return;
        }
        
        this.isLoading = true;
        this.paymentError = '';
        
        // First, create the booking in the database
        createBooking({
            flightId: this.selectedFlight.id,
            totalAmount: parseFloat(this.totalAmount)
        })
        .then(booking => {
            this.bookingId = booking.Id;
            this.bookingReference = booking.Name;
            
            // Then add passengers
            return addPassengers({
                bookingId: this.bookingId,
                passengers: this.passengerForms.map((passenger, index) => {
                    return {
                        name: passenger.name,
                        email: passenger.email,
                        seatNumber: this.selectedSeats[index] || ''
                    };
                })
            });
        })
        .then(() => {
            // Confirm the card payment with Stripe
            return this.stripe.confirmCardPayment(this.paymentIntent.clientSecret, {
                payment_method: {
                    card: this.cardElement,
                    billing_details: {
                        name: this.passengerForms[0].name,
                        email: this.passengerForms[0].email
                    }
                }
            });
        })
        .then(result => {
            if (result.error) {
                throw new Error(result.error.message);
            }
            
            // Payment confirmed with Stripe, now update our database
            return processPayment({
                bookingId: this.bookingId,
                stripeToken: this.paymentIntent.paymentIntentId,
                amount: parseFloat(this.totalAmount)
            });
        })
        .then(() => {
            this.isLoading = false;
            this.currentStep = 'confirmation';
        })
        .catch(error => {
            console.error('Error processing payment', error);
            this.paymentError = error.message || 'Failed to process payment. Please try again.';
            this.isLoading = false;
        });
    }
    
    // Confirmation page handlers
    handleDownloadTicket() {
        generateTicket({ bookingId: this.bookingId })
            .then(ticketUrl => {
                window.open(ticketUrl, '_blank');
            })
            .catch(error => {
                console.error('Error generating ticket', error);
                this.errorMessage = 'Failed to generate ticket.';
            });
    }
    
    handleEmailTicket() {
        // Here we would implement email sending logic
        // For now, just show a confirmation
        alert(`Ticket has been emailed to ${this.mainPassengerEmail}`);
    }
    
    handleReturnToHome() {
        // Reset the form and go back to the search step
        this.resetForm();
        this.currentStep = 'search';
    }
    
    resetForm() {
        // Reset all form data
        this.tripType = 'oneWay';
        this.origin = '';
        this.destination = '';
        this.departureDate = this.today;
        this.returnDate = '';
        this.adults = 1;
        this.children = 0;
        this.infants = 0;
        
        this.availableFlights = [];
        this.selectedFlight = null;
        
        this.seatRows = [];
        this.selectedSeats = [];
        
        this.passengerForms = [];
        
        this.bookingId = '';
        this.bookingReference = '';
        
        this.errorMessage = '';
    }
    
    navigateToManageBookings() {
        // In a real app, we would navigate to a booking management page
        alert('Navigate to Manage Bookings page');
    }
}
