
import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getBookingHistory from '@salesforce/apex/FlightBookingService.getBookingHistory';
import processRefund from '@salesforce/apex/StripeService.processRefund';
import generateTicket from '@salesforce/apex/FlightBookingService.generateTicket';

export default class ManageBookings extends NavigationMixin(LightningElement) {
    @track bookingReference = '';
    @track email = '';
    @track isLoading = false;
    @track errorMessage = '';
    @track bookings = [];
    
    @track selectedBooking = null;
    @track passengers = [];
    @track showBookingDetails = false;
    @track showCancelConfirmation = false;
    @track bookingToCancel = '';
    @track refundPercentage = 0;
    
    // Search booking by reference and email
    handleSearchBooking() {
        if (!this.email) {
            this.errorMessage = 'Please enter your email address.';
            return;
        }
        
        this.isLoading = true;
        this.errorMessage = '';
        
        getBookingHistory({ email: this.email })
            .then(result => {
                this.processBookings(result);
                this.isLoading = false;
            })
            .catch(error => {
                console.error('Error retrieving bookings', error);
                this.errorMessage = 'Failed to retrieve bookings. ' + (error.body ? error.body.message : error.message);
                this.bookings = [];
                this.isLoading = false;
            });
    }
    
    // Process bookings data and format dates/times
    processBookings(bookingsData) {
        if (bookingsData && bookingsData.length > 0) {
            this.bookings = bookingsData.map(booking => {
                const departureDateTime = new Date(booking.Flight__r.DepartureDateTime__c);
                const arrivalDateTime = new Date(booking.Flight__r.ArrivalDateTime__c);
                
                // Calculate if cancellation is allowed (more than 24 hours before departure)
                const now = new Date();
                const hoursBefore = (departureDateTime - now) / (1000 * 60 * 60);
                const canCancel = hoursBefore > 24 && booking.BookingStatus__c === 'Confirmed';
                
                // Can only download ticket if booking is confirmed
                const canDownload = booking.BookingStatus__c === 'Confirmed';
                
                // Apply status styling
                let statusClass = 'status';
                switch(booking.BookingStatus__c) {
                    case 'Confirmed':
                        statusClass += ' confirmed';
                        break;
                    case 'Cancelled':
                        statusClass += ' cancelled';
                        break;
                    case 'Reserved':
                        statusClass += ' reserved';
                        break;
                    default:
                        break;
                }
                
                return {
                    ...booking,
                    formattedDepartureDate: this.formatDate(departureDateTime),
                    formattedDepartureTime: this.formatTime(departureDateTime),
                    formattedArrivalDate: this.formatDate(arrivalDateTime),
                    formattedArrivalTime: this.formatTime(arrivalDateTime),
                    canCancel,
                    canDownload,
                    statusClass
                };
            });
            
            // If a specific booking reference was provided, filter by it
            if (this.bookingReference) {
                this.bookings = this.bookings.filter(b => 
                    b.Name.toLowerCase() === this.bookingReference.toLowerCase()
                );
            }
            
        } else {
            this.bookings = [];
        }
    }
    
    // View booking details
    handleViewBooking(event) {
        const bookingId = event.currentTarget.dataset.id;
        this.selectedBooking = this.bookings.find(b => b.Id === bookingId);
        
        if (this.selectedBooking) {
            // In a real app, we would fetch the passengers associated with this booking
            // For now, let's create mock passenger data
            this.passengers = [
                { Id: 'p1', Name: 'John Doe', SeatNumber__c: '12A' },
                { Id: 'p2', Name: 'Jane Smith', SeatNumber__c: '12B' }
            ];
            
            this.showBookingDetails = true;
        }
    }
    
    // Close booking details modal
    closeBookingDetails() {
        this.showBookingDetails = false;
    }
    
    // Handle cancel booking request
    handleCancelBooking(event) {
        const bookingId = event.currentTarget.dataset.id;
        this.bookingToCancel = bookingId;
        
        // Calculate refund percentage
        const booking = this.bookings.find(b => b.Id === bookingId);
        if (booking) {
            const departureDateTime = new Date(booking.Flight__r.DepartureDateTime__c);
            const now = new Date();
            const hoursBefore = (departureDateTime - now) / (1000 * 60 * 60);
            
            if (hoursBefore > 72) {
                this.refundPercentage = 75;
            } else if (hoursBefore > 24) {
                this.refundPercentage = 50;
            } else {
                this.refundPercentage = 0;
            }
        }
        
        this.showCancelConfirmation = true;
    }
    
    // Handle cancel booking from details modal
    handleCancelSelectedBooking() {
        if (this.selectedBooking) {
            this.bookingToCancel = this.selectedBooking.Id;
            
            // Calculate refund percentage (same logic as above)
            const departureDateTime = new Date(this.selectedBooking.Flight__r.DepartureDateTime__c);
            const now = new Date();
            const hoursBefore = (departureDateTime - now) / (1000 * 60 * 60);
            
            if (hoursBefore > 72) {
                this.refundPercentage = 75;
            } else if (hoursBefore > 24) {
                this.refundPercentage = 50;
            } else {
                this.refundPercentage = 0;
            }
            
            this.showBookingDetails = false;
            this.showCancelConfirmation = true;
        }
    }
    
    // Close cancel confirmation modal
    closeCancelConfirmation() {
        this.showCancelConfirmation = false;
    }
    
    // Confirm booking cancellation
    confirmCancelBooking() {
        this.isLoading = true;
        this.errorMessage = '';
        
        // Find the booking payment to refund
        const booking = this.bookings.find(b => b.Id === this.bookingToCancel);
        if (!booking) {
            this.errorMessage = 'Booking not found.';
            this.isLoading = false;
            return;
        }
        
        // In a real app, we would fetch the payment record associated with this booking
        // For now, let's assume a mock payment ID
        const paymentId = 'mock_payment_id';
        
        processRefund({ paymentId })
            .then(() => {
                // Update local booking status
                booking.BookingStatus__c = 'Cancelled';
                booking.statusClass = 'status cancelled';
                booking.canCancel = false;
                booking.canDownload = false;
                
                this.isLoading = false;
                this.showCancelConfirmation = false;
                
                // Show success message
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Success',
                        message: 'Booking cancelled successfully.',
                        variant: 'success'
                    })
                );
            })
            .catch(error => {
                console.error('Error cancelling booking', error);
                this.errorMessage = 'Failed to cancel booking. ' + (error.body ? error.body.message : error.message);
                this.isLoading = false;
                this.showCancelConfirmation = false;
            });
    }
    
    // Download ticket
    handleDownloadTicket(event) {
        const bookingId = event.currentTarget.dataset.id;
        this.downloadTicket(bookingId);
    }
    
    // Download ticket from details modal
    handleDownloadSelectedTicket() {
        if (this.selectedBooking) {
            this.downloadTicket(this.selectedBooking.Id);
        }
    }
    
    // Common download ticket logic
    downloadTicket(bookingId) {
        this.isLoading = true;
        
        generateTicket({ bookingId })
            .then(ticketUrl => {
                window.open(ticketUrl, '_blank');
                this.isLoading = false;
            })
            .catch(error => {
                console.error('Error generating ticket', error);
                this.errorMessage = 'Failed to generate ticket. ' + (error.body ? error.body.message : error.message);
                this.isLoading = false;
            });
    }
    
    // Input change handlers
    handleReferenceChange(event) {
        this.bookingReference = event.target.value;
    }
    
    handleEmailChange(event) {
        this.email = event.target.value;
    }
    
    // Navigate to booking page
    navigateToBooking() {
        this[NavigationMixin.Navigate]({
            type: 'standard__webPage',
            attributes: {
                url: '/flight-booking'
            }
        });
    }
    
    // Helper methods for date and time formatting
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
    
    // Computed properties for UI states
    get hasBookings() {
        return this.bookings && this.bookings.length > 0;
    }
    
    get noBookingsFound() {
        return !this.isLoading && this.email && this.bookings && this.bookings.length === 0;
    }
    
    get hasPassengers() {
        return this.passengers && this.passengers.length > 0;
    }
}
