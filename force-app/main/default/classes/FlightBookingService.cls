
/**
 * FlightBookingService - Main service class for flight booking operations
 */
public with sharing class FlightBookingService {
    
    // Amadeus API keys (store these in a protected custom setting in a production environment)
    private static final String AMADEUS_API_KEY = 'YOUR_AMADEUS_API_KEY';
    private static final String AMADEUS_API_SECRET = 'YOUR_AMADEUS_API_SECRET';
    private static final String AMADEUS_TOKEN_ENDPOINT = 'https://test.api.amadeus.com/v1/security/oauth2/token';
    private static final String AMADEUS_FLIGHT_OFFERS_ENDPOINT = 'https://test.api.amadeus.com/v2/shopping/flight-offers';
    
    /**
     * Search flights using Amadeus API
     */
    @AuraEnabled
    public static Map<String, Object> searchFlights(String origin, String destination, String departureDate, 
                                                  Integer adults, Integer children, Integer infants) {
        try {
            // First get access token
            String accessToken = getAmadeusAccessToken();
            
            // Build API request
            Http http = new Http();
            HttpRequest request = new HttpRequest();
            request.setEndpoint(AMADEUS_FLIGHT_OFFERS_ENDPOINT);
            request.setMethod('GET');
            request.setHeader('Authorization', 'Bearer ' + accessToken);
            
            // Build query parameters
            String queryParams = 'originLocationCode=' + origin +
                                '&destinationLocationCode=' + destination +
                                '&departureDate=' + departureDate +
                                '&adults=' + adults +
                                '&children=' + (children != null ? children : 0) +
                                '&infants=' + (infants != null ? infants : 0) +
                                '&currencyCode=USD&max=20';
                                
            request.setEndpoint(AMADEUS_FLIGHT_OFFERS_ENDPOINT + '?' + queryParams);
            
            // Execute callout
            HttpResponse response = http.send(request);
            
            // Process response
            if (response.getStatusCode() == 200) {
                // Parse JSON response
                Map<String, Object> resultsMap = (Map<String, Object>)JSON.deserializeUntyped(response.getBody());
                saveFlightsToDatabase(resultsMap);
                return resultsMap;
            } else {
                System.debug('Error: ' + response.getBody());
                throw new AuraHandledException('Error fetching flights: ' + response.getStatusCode() + ' ' + response.getStatus());
            }
        } catch(Exception e) {
            System.debug('Exception: ' + e.getMessage() + ' ' + e.getStackTraceString());
            throw new AuraHandledException('Error searching flights: ' + e.getMessage());
        }
    }
    
    /**
     * Get Amadeus API access token
     */
    private static String getAmadeusAccessToken() {
        Http http = new Http();
        HttpRequest request = new HttpRequest();
        request.setEndpoint(AMADEUS_TOKEN_ENDPOINT);
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        
        String requestBody = 'grant_type=client_credentials&client_id=' + 
                            AMADEUS_API_KEY + '&client_secret=' + AMADEUS_API_SECRET;
        request.setBody(requestBody);
        
        HttpResponse response = http.send(request);
        
        if (response.getStatusCode() == 200) {
            Map<String, Object> tokenResponse = (Map<String, Object>)JSON.deserializeUntyped(response.getBody());
            return (String)tokenResponse.get('access_token');
        } else {
            throw new AuraHandledException('Failed to get Amadeus access token: ' + response.getStatusCode() + ' ' + response.getStatus());
        }
    }
    
    /**
     * Save flight search results to database for faster retrieval
     */
    private static void saveFlightsToDatabase(Map<String, Object> flightResults) {
        try {
            List<Flight__c> flightsToInsert = new List<Flight__c>();
            List<Object> flightData = (List<Object>)flightResults.get('data');
            
            if (flightData != null) {
                for (Object flightObj : flightData) {
                    Map<String, Object> flight = (Map<String, Object>)flightObj;
                    
                    // Extract flight info
                    List<Object> itineraries = (List<Object>)flight.get('itineraries');
                    Map<String, Object> price = (Map<String, Object>)flight.get('price');
                    String flightNumber = extractFlightNumber(itineraries);
                    
                    Flight__c flightRecord = new Flight__c(
                        Name = flightNumber,
                        Origin__c = extractOrigin(itineraries),
                        Destination__c = extractDestination(itineraries),
                        DepartureDateTime__c = parseDateTime(extractDepartureTime(itineraries)),
                        ArrivalDateTime__c = parseDateTime(extractArrivalTime(itineraries)),
                        BasePrice__c = Decimal.valueOf(String.valueOf(price.get('grandTotal'))),
                        AvailableSeats__c = 50 // Default value
                    );
                    
                    flightsToInsert.add(flightRecord);
                }
                
                if (!flightsToInsert.isEmpty()) {
                    insert flightsToInsert;
                }
            }
        } catch(Exception e) {
            // Log error but don't throw to user
            System.debug('Error saving flights: ' + e.getMessage());
        }
    }
    
    // Helper methods to extract data from Amadeus response
    private static String extractFlightNumber(List<Object> itineraries) {
        if (itineraries != null && !itineraries.isEmpty()) {
            Map<String, Object> itinerary = (Map<String, Object>)itineraries[0];
            List<Object> segments = (List<Object>)itinerary.get('segments');
            if (segments != null && !segments.isEmpty()) {
                Map<String, Object> segment = (Map<String, Object>)segments[0];
                Map<String, Object> carrierInfo = (Map<String, Object>)segment.get('carrierCode');
                Map<String, Object> flightInfo = (Map<String, Object>)segment.get('number');
                return String.valueOf(carrierInfo) + String.valueOf(flightInfo);
            }
        }
        return 'Unknown';
    }
    
    private static String extractOrigin(List<Object> itineraries) {
        if (itineraries != null && !itineraries.isEmpty()) {
            Map<String, Object> itinerary = (Map<String, Object>)itineraries[0];
            List<Object> segments = (List<Object>)itinerary.get('segments');
            if (segments != null && !segments.isEmpty()) {
                Map<String, Object> segment = (Map<String, Object>)segments[0];
                Map<String, Object> departureInfo = (Map<String, Object>)segment.get('departure');
                return String.valueOf(departureInfo.get('iataCode'));
            }
        }
        return '';
    }
    
    private static String extractDestination(List<Object> itineraries) {
        if (itineraries != null && !itineraries.isEmpty()) {
            Map<String, Object> itinerary = (Map<String, Object>)itineraries[0];
            List<Object> segments = (List<Object>)itinerary.get('segments');
            if (segments != null && !segments.isEmpty()) {
                Integer lastIndex = segments.size() - 1;
                Map<String, Object> segment = (Map<String, Object>)segments[lastIndex];
                Map<String, Object> arrivalInfo = (Map<String, Object>)segment.get('arrival');
                return String.valueOf(arrivalInfo.get('iataCode'));
            }
        }
        return '';
    }
    
    private static String extractDepartureTime(List<Object> itineraries) {
        if (itineraries != null && !itineraries.isEmpty()) {
            Map<String, Object> itinerary = (Map<String, Object>)itineraries[0];
            List<Object> segments = (List<Object>)itinerary.get('segments');
            if (segments != null && !segments.isEmpty()) {
                Map<String, Object> segment = (Map<String, Object>)segments[0];
                Map<String, Object> departureInfo = (Map<String, Object>)segment.get('departure');
                return String.valueOf(departureInfo.get('at'));
            }
        }
        return '';
    }
    
    private static String extractArrivalTime(List<Object> itineraries) {
        if (itineraries != null && !itineraries.isEmpty()) {
            Map<String, Object> itinerary = (Map<String, Object>)itineraries[0];
            List<Object> segments = (List<Object>)itinerary.get('segments');
            if (segments != null && !segments.isEmpty()) {
                Integer lastIndex = segments.size() - 1;
                Map<String, Object> segment = (Map<String, Object>)segments[lastIndex];
                Map<String, Object> arrivalInfo = (Map<String, Object>)segment.get('arrival');
                return String.valueOf(arrivalInfo.get('at'));
            }
        }
        return '';
    }
    
    private static Datetime parseDateTime(String dateTimeStr) {
        if (String.isNotBlank(dateTimeStr)) {
            try {
                // Parse ISO8601 format (2023-05-15T10:30:00)
                return (Datetime)JSON.deserialize('"' + dateTimeStr + '"', Datetime.class);
            } catch(Exception e) {
                System.debug('Error parsing date: ' + e.getMessage());
            }
        }
        return Datetime.now();
    }
    
    /**
     * Create a new booking
     */
    @AuraEnabled
    public static Booking__c createBooking(String flightId, Decimal totalAmount) {
        try {
            Booking__c booking = new Booking__c(
                Flight__c = flightId,
                TotalAmount__c = totalAmount,
                BookingStatus__c = 'Reserved'
            );
            
            insert booking;
            return booking;
        } catch(Exception e) {
            throw new AuraHandledException('Error creating booking: ' + e.getMessage());
        }
    }
    
    /**
     * Add passengers to the booking
     */
    @AuraEnabled
    public static List<Passenger__c> addPassengers(String bookingId, List<Map<String, Object>> passengers) {
        try {
            List<Passenger__c> passengerRecords = new List<Passenger__c>();
            
            for (Map<String, Object> passengerData : passengers) {
                String name = (String)passengerData.get('name');
                String email = (String)passengerData.get('email');
                String seatNumber = (String)passengerData.get('seatNumber');
                
                Passenger__c passenger = new Passenger__c(
                    Name = name,
                    Email__c = email,
                    SeatNumber__c = seatNumber,
                    Booking__c = bookingId
                );
                
                passengerRecords.add(passenger);
            }
            
            if (!passengerRecords.isEmpty()) {
                insert passengerRecords;
            }
            
            return passengerRecords;
        } catch(Exception e) {
            throw new AuraHandledException('Error adding passengers: ' + e.getMessage());
        }
    }
    
    /**
     * Process payment via Stripe
     */
    @AuraEnabled
    public static Payment__c processPayment(String bookingId, String stripeToken, Decimal amount) {
        try {
            // Call Stripe API to process payment - this would be implemented using a callout
            // In a real implementation, you'd make a callout to Stripe's API here
            String stripePaymentId = 'test_' + String.valueOf(Math.random()).substring(2, 10);
            
            // Create payment record
            Payment__c payment = new Payment__c(
                Booking__c = bookingId,
                Amount__c = amount,
                StripePaymentId__c = stripePaymentId,
                PaymentStatus__c = 'Completed'
            );
            
            insert payment;
            
            // Update booking status to Confirmed
            Booking__c booking = [SELECT Id, BookingStatus__c FROM Booking__c WHERE Id = :bookingId LIMIT 1];
            booking.BookingStatus__c = 'Confirmed';
            update booking;
            
            // In a real implementation, we would also update the available seats on the flight record
            
            return payment;
        } catch(Exception e) {
            throw new AuraHandledException('Error processing payment: ' + e.getMessage());
        }
    }
    
    /**
     * Process refund via Stripe
     */
    @AuraEnabled
    public static Payment__c processRefund(String paymentId) {
        try {
            // Retrieve the payment
            Payment__c payment = [SELECT Id, StripePaymentId__c, Booking__c FROM Payment__c WHERE Id = :paymentId LIMIT 1];
            
            // Call Stripe API to process refund - this would be implemented using a callout
            // In a real implementation, you'd make a callout to Stripe's API here
            
            // Update payment status
            payment.PaymentStatus__c = 'Refunded';
            update payment;
            
            // Update booking status to Cancelled
            Booking__c booking = [SELECT Id, BookingStatus__c FROM Booking__c WHERE Id = :payment.Booking__c LIMIT 1];
            booking.BookingStatus__c = 'Cancelled';
            update booking;
            
            return payment;
        } catch(Exception e) {
            throw new AuraHandledException('Error processing refund: ' + e.getMessage());
        }
    }
    
    /**
     * Get booking history for a user (based on email)
     */
    @AuraEnabled
    public static List<Booking__c> getBookingHistory(String email) {
        try {
            List<Id> bookingIds = new List<Id>();
            for (Passenger__c p : [SELECT Booking__c FROM Passenger__c WHERE Email__c = :email]) {
                bookingIds.add(p.Booking__c);
            }
            
            return [
                SELECT Id, Name, Flight__r.Name, Flight__r.Origin__c, Flight__r.Destination__c, 
                       Flight__r.DepartureDateTime__c, Flight__r.ArrivalDateTime__c, 
                       TotalAmount__c, BookingStatus__c
                FROM Booking__c 
                WHERE Id IN :bookingIds
                ORDER BY Flight__r.DepartureDateTime__c DESC
            ];
        } catch(Exception e) {
            throw new AuraHandledException('Error retrieving booking history: ' + e.getMessage());
        }
    }
    
    /**
     * Generate PDF ticket (mock implementation)
     */
    @AuraEnabled
    public static String generateTicket(String bookingId) {
        try {
            // In a real implementation, you would generate a PDF and return its URL or content
            return '/mock/ticket/' + bookingId + '.pdf';
        } catch(Exception e) {
            throw new AuraHandledException('Error generating ticket: ' + e.getMessage());
        }
    }
}
