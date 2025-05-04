
/**
 * StripeService - Handles Stripe payment integration
 */
public with sharing class StripeService {
    
    // Stripe API key (store this in a protected custom setting in a production environment)
    private static final String STRIPE_API_KEY = 'YOUR_STRIPE_API_KEY';
    private static final String STRIPE_API_ENDPOINT = 'https://api.stripe.com/v1';
    
    /**
     * Create a payment intent
     */
    @AuraEnabled
    public static Map<String, String> createPaymentIntent(Decimal amount, String currency) {
        try {
            // Prepare request for Stripe API
            Http http = new Http();
            HttpRequest request = new HttpRequest();
            request.setEndpoint(STRIPE_API_ENDPOINT + '/payment_intents');
            request.setMethod('POST');
            request.setHeader('Authorization', 'Bearer ' + STRIPE_API_KEY);
            request.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            
            // Convert amount to cents/smallest currency unit as required by Stripe
            Integer amountInCents = Integer.valueOf(amount * 100);
            
            String requestBody = 'amount=' + amountInCents + 
                               '&currency=' + currency +
                               '&automatic_payment_methods[enabled]=true';
            request.setBody(requestBody);
            
            HttpResponse response = http.send(request);
            
            if (response.getStatusCode() == 200) {
                Map<String, Object> responseData = (Map<String, Object>)JSON.deserializeUntyped(response.getBody());
                
                // Return client secret to frontend for completing the payment
                return new Map<String, String>{
                    'clientSecret' => (String)responseData.get('client_secret'),
                    'paymentIntentId' => (String)responseData.get('id')
                };
            } else {
                System.debug('Stripe error: ' + response.getBody());
                throw new AuraHandledException('Error creating payment: ' + response.getStatusCode());
            }
        } catch(Exception e) {
            throw new AuraHandledException('Error processing payment: ' + e.getMessage());
        }
    }
    
    /**
     * Confirm payment success (webhook handler mock)
     */
    @AuraEnabled
    public static Boolean confirmPaymentSuccess(String paymentIntentId, String bookingId) {
        try {
            // In a real implementation, you would verify with Stripe that the payment succeeded
            // For now, we'll mock this behavior
            
            // Update payment record
            List<Payment__c> payments = [
                SELECT Id, PaymentStatus__c 
                FROM Payment__c 
                WHERE StripePaymentId__c = :paymentIntentId
                LIMIT 1
            ];
            
            if (!payments.isEmpty()) {
                Payment__c payment = payments[0];
                payment.PaymentStatus__c = 'Completed';
                update payment;
                
                // Update booking status
                Booking__c booking = [SELECT Id, BookingStatus__c FROM Booking__c WHERE Id = :bookingId LIMIT 1];
                booking.BookingStatus__c = 'Confirmed';
                update booking;
                
                return true;
            }
            
            return false;
        } catch(Exception e) {
            throw new AuraHandledException('Error confirming payment: ' + e.getMessage());
        }
    }
    
    /**
     * Process refund
     */
    @AuraEnabled
    public static Boolean processRefund(String paymentIntentId) {
        try {
            // Prepare request for Stripe API
            Http http = new Http();
            HttpRequest request = new HttpRequest();
            request.setEndpoint(STRIPE_API_ENDPOINT + '/refunds');
            request.setMethod('POST');
            request.setHeader('Authorization', 'Bearer ' + STRIPE_API_KEY);
            request.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            
            String requestBody = 'payment_intent=' + paymentIntentId;
            request.setBody(requestBody);
            
            HttpResponse response = http.send(request);
            
            if (response.getStatusCode() == 200) {
                Map<String, Object> responseData = (Map<String, Object>)JSON.deserializeUntyped(response.getBody());
                String refundId = (String)responseData.get('id');
                String status = (String)responseData.get('status');
                
                // Find the payment and update it
                List<Payment__c> payments = [
                    SELECT Id, PaymentStatus__c, Booking__c 
                    FROM Payment__c 
                    WHERE StripePaymentId__c = :paymentIntentId
                    LIMIT 1
                ];
                
                if (!payments.isEmpty()) {
                    Payment__c payment = payments[0];
                    payment.PaymentStatus__c = 'Refunded';
                    update payment;
                    
                    // Update booking status
                    Booking__c booking = [SELECT Id, BookingStatus__c FROM Booking__c WHERE Id = :payment.Booking__c LIMIT 1];
                    booking.BookingStatus__c = 'Cancelled';
                    update booking;
                    
                    return true;
                }
                
                return false;
            } else {
                System.debug('Stripe error: ' + response.getBody());
                throw new AuraHandledException('Error processing refund: ' + response.getStatusCode());
            }
        } catch(Exception e) {
            throw new AuraHandledException('Error processing refund: ' + e.getMessage());
        }
    }
}
