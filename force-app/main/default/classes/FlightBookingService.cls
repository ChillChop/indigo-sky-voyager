
/**
 * FlightBookingService - Main service class for flight booking operations
 */
public with sharing class FlightBookingService {
    
    private static final String AMADEUS_API_KEY = 'YOUR_AMADEUS_API_KEY';
    private static final String AMADEUS_API_SECRET = 'YOUR_AMADEUS_API_SECRET';
    private static final String AMADEUS_TOKEN_ENDPOINT = 'https://test.api.amadeus.com/v1/security/oauth2/token';
    private static final String AMADEUS_FLIGHT_OFFERS_ENDPOINT = 'https://test.api.amadeus.com/v2/shopping/flight-offers';
    
    @AuraEnabled
    public static Map<String, Object> searchFlights(String origin, String destination, String departureDate, 
                                                  Integer adults, Integer children, Integer infants) {
        try {
            String accessToken = getAmadeusAccessToken();
            
            Http http = new Http();
            HttpRequest request = new HttpRequest();
            request.setEndpoint(AMADEUS_FLIGHT_OFFERS_ENDPOINT);
            request.setMethod('GET');
            request.setHeader('Authorization', 'Bearer ' + accessToken);
            
            String queryParams = 'originLocationCode=' + origin +
                                '&destinationLocationCode=' + destination +
                                '&departureDate=' + departureDate +
                                '&adults=' + adults +
                                '&children=' + (children != null ? children : 0) +
                                '&infants=' + (infants != null ? infants : 0) +
                                '&currencyCode=USD&max=20';
                                
            request.setEndpoint(AMADEUS_FLIGHT_OFFERS_ENDPOINT + '?' + queryParams);
            
            HttpResponse response = http.send(request);
            
            if (response.getStatusCode() == 200) {
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
    
    private static void saveFlightsToDatabase(Map<String, Object> flightResults) {
        try {
            List<Flight__c> flightsToInsert = new List<Flight__c>();
            List<Object> flightData = (List<Object>)flightResults.get('data');
            
            if (flightData != null) {
                for (Object flightObj : flightData) {
                    Map<String, Object> flight = (Map<String, Object>)flightObj;
                    
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
                return (Datetime)JSON.deserialize('"' + dateTimeStr + '"', Datetime.class);
            } catch(Exception e) {
                System.debug('Error parsing date: ' + e.getMessage());
            }
        }
        return Datetime.now();
    }
    
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
    
    @AuraEnabled
    public static String generateTicket(String bookingId) {
        try {
            return '/mock/ticket/' + bookingId + '.pdf';
        } catch(Exception e) {
            throw new AuraHandledException('Error generating ticket: ' + e.getMessage());
        }
    }
}
