import AfricasTalking from 'africastalking';

const apiKey = process.env.AT_API_KEY;
const username = process.env.AT_USERNAME;

// Initialize only if credentials exist to prevent crash
let sms: any = null;
if (apiKey && username) {
  const AT = AfricasTalking({ apiKey, username });
  sms = AT.SMS;
}

export async function sendSms(to: string[], message: string) {
  if (!sms) {
    console.warn('Africa\'s Talking credentials missing. SMS skipped:', { to, message });
    return { success: false, error: 'Credentials not configured' };
  }

  try {
    const response = await sms.send({ to, message });
    return { success: true, response };
  } catch (error) {
    console.error('Error sending SMS via Africa\'s Talking:', error);
    return { success: false, error };
  }
}