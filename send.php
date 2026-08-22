<?php
/**
 * Glovels form handler.
 *
 * Receives the counselling form and package requests, emails the office, and
 * sends the enquirer a copy. Runs on one.com's PHP hosting, so nothing leaves
 * your own domain and there is no third-party form service to pay for or trust
 * with student data.
 *
 * Set "Form endpoint URL" on the Settings sheet to:  /send.php
 *
 * Upload alongside the HTML, in httpd.www.
 */

declare(strict_types=1);

// ---------------------------------------------------------------- configure
// Filled from the Settings sheet at build time - do not edit here, edit the
// workbook. info@glovels.com is where enquiries land; website@glovels.com must be a real mailbox on
// this domain or the mail is likely to be treated as spam.
$TO       = 'info@glovels.com';
$FROM     = 'website@glovels.com';
$SITE     = 'Glovels';
$LOG      = __DIR__ . '/../httpd.private/enquiries.log';  // outside the web root

header('Content-Type: application/json');

// Same-origin only, and POST only.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['ok' => false, 'error' => 'POST only']));
}

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    $data = $_POST;                            // also accept a normal form post
}

// ------------------------------------------------------------------ filters
// A bot filling the hidden field, or submitting nothing, gets a polite 200 and
// no email. Returning an error would tell it what to change.
if (!empty($data['website'])) {
    exit(json_encode(['ok' => true]));
}

$name  = trim((string)($data['name']  ?? ''));
$phone = trim((string)($data['phone'] ?? ''));
$email = trim((string)($data['email'] ?? ''));

if ($name === '' || $phone === '' || $email === '') {
    http_response_code(422);
    exit(json_encode(['ok' => false, 'error' => 'Name, phone and email are required']));
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(422);
    exit(json_encode(['ok' => false, 'error' => 'That email address is not valid']));
}
// Indian mobile: ten digits starting 6-9, ignoring any country code or spacing.
$digits = preg_replace('/\D+/', '', $phone);
if (!preg_match('/[6-9]\d{9}$/', $digits)) {
    http_response_code(422);
    exit(json_encode(['ok' => false, 'error' => 'That mobile number is not valid']));
}

// Header injection: a newline in a field could add a Bcc to the message.
foreach ([$name, $email] as $v) {
    if (preg_match('/[\r\n]/', $v)) {
        http_response_code(400);
        exit(json_encode(['ok' => false, 'error' => 'Invalid characters']));
    }
}

// Rate limiting, in two tiers.
//
// A per-IP cap alone is wrong here: Indian mobile carriers use carrier-grade NAT,
// so an entire city can share one address. A tight per-IP limit would turn away
// real students during a campaign.
//
// So: a generous per-IP backstop against a script, and a tight limit per IP AND
// email, which is what actually stops the same person or bot resubmitting.
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

$limit = function (string $key, int $max) : bool {
    $stamp = sys_get_temp_dir() . '/glovels_' . md5($key);
    $fresh = @file_exists($stamp) && (time() - @filemtime($stamp) < 3600);
    $hits  = $fresh ? (int)@file_get_contents($stamp) : 0;
    if ($hits >= $max) {
        return false;
    }
    @file_put_contents($stamp, $hits + 1);
    return true;
};

if (!$limit('id:' . $ip . '|' . strtolower($email), 3)) {
    http_response_code(429);
    exit(json_encode(['ok' => false,
        'error' => 'We already have that request. A counsellor will call you shortly.']));
}
if (!$limit('ip:' . $ip, 60)) {
    http_response_code(429);
    exit(json_encode(['ok' => false,
        'error' => 'Too many requests from this connection. Please call the office.']));
}

// -------------------------------------------------------------- the message
$formName = (string)($data['form'] ?? 'Website enquiry');
$order    = ['form', 'reference', 'package', 'indicativePrice', 'publicUniversities',
             'name', 'phone', 'email', 'destination', 'searchedFor',
             'consent', 'consentAt', 'consentWording', 'sourcePage', 'referrer'];

$lines = [];
foreach ($order as $k) {
    if (!empty($data[$k])) {
        $label = ucfirst(preg_replace('/(?<!^)[A-Z]/', ' $0', $k));
        $lines[] = str_pad($label . ':', 20) . (string)$data[$k];
    }
}
foreach ($data as $k => $v) {                  // anything not in the list above
    if (!in_array($k, $order, true) && $k !== 'website' && !str_starts_with($k, '_')
        && is_scalar($v) && $v !== '') {
        $lines[] = str_pad(ucfirst($k) . ':', 20) . (string)$v;
    }
}
$lines[] = '';
$lines[] = str_pad('Received:', 20) . date('d M Y, H:i') . ' server time';
$lines[] = str_pad('IP:', 20) . $ip;
$body = implode("\n", $lines);

$headers = implode("\r\n", [
    'From: ' . $SITE . ' website <' . $FROM . '>',
    'Reply-To: ' . $name . ' <' . $email . '>',   // replying goes to the student
    'Content-Type: text/plain; charset=UTF-8',
    'X-Mailer: glovels-send.php',
]);

$subject = $formName . ' - ' . $name;
if (!empty($data['reference'])) {
    $subject .= ' (' . $data['reference'] . ')';
}

$sent = @mail($TO, $subject, $body, $headers);

// Written whether or not the mail went out, so an enquiry is never lost to a
// mail outage. Sits outside the web root — it holds personal data.
@file_put_contents($LOG, date('c') . ' ' . ($sent ? 'SENT' : 'MAIL-FAILED') . "\n"
    . $body . "\n" . str_repeat('-', 60) . "\n", FILE_APPEND);

if (!$sent) {
    http_response_code(500);
    exit(json_encode(['ok' => false,
        'error' => 'We could not send that. Please call the office or email us directly.']));
}

// ------------------------------------------------------- copy to the student
// Reassurance costs one more message and prevents "did that go through?" calls.
$ack = "Hi " . $name . ",\n\n"
     . "Thanks for getting in touch with Glovels. We have your request"
     . (!empty($data['reference']) ? " (reference " . $data['reference'] . ")" : "")
     . " and a counsellor will call you within one working day, Mon-Sat, "
     . "9:30am to 7:30pm IST.\n\n"
     . "Nothing is charged for the call and there is no obligation.\n\n"
     . "If you need us sooner, reply to this email or call the office.\n\n"
     . "Glovels\n" . $TO . "\n";
@mail($email, 'We have your request - Glovels', $ack, implode("\r\n", [
    'From: ' . $SITE . ' <' . $FROM . '>',
    'Reply-To: ' . $TO,
    'Content-Type: text/plain; charset=UTF-8',
]));

echo json_encode(['ok' => true]);
