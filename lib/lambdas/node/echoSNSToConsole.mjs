exports.handler = async (event) => {
    try {
        if (!event.Records || event.Records.length === 0) {
            console.log("No messages received");
            return {
                statusCode: 200,
                body: "No messages to process"
            };
        }
        
        // Log each message to the console
        event.Records.forEach((record, index) => {
            console.log('Message:', JSON.stringify(record.body, null, 2));
            /******
             * Insert Code Here to process the message
             */
        });
        
        console.log(`Successfully logged ${event.Records.length} messages`);
        
        return {
            statusCode: 200,
            body: `Processed ${event.Records.length} messages`
        };
        
    } catch (error) {
        console.error("Error:", error);
        throw error;
    }
};