import email
from email import policy

def get_email_content(file_content):
    message = email.message_from_string(file_content, policy=policy.default)
    email_content = ""
    sender_email = message.get("From")
    subject = message.get("Subject", "")

    if message.is_multipart():
        for part in message.iter_parts():
            content_type = part.get_content_type()
            charset = part.get_content_charset() or 'utf-8'
            if content_type in ["text/plain", "text/html"]:
                email_content += part.get_payload(decode=True).decode(charset)
    else:
        email_content = message.get_payload(decode=True).decode(message.get_content_charset() or 'utf-8')
    
    # Concatenate the subject with the email content
    full_content = f"Subject: {subject} \n\n\n Email content: {email_content}"
    
    return full_content, sender_email, subject