if ($request ~ "^[A-Z]+[ ]+https?://") { return 400; }
if ($request_uri ~* "^[^?]*(?:%2e|%2f|%3f|%23|%5c|%25|%0[0-9a-f]|%1[0-9a-f]|%7f|%(?![0-9a-f]{2})|\\\\|//|;)") { return 400; }
if ($request_uri ~ "(?:^|/)\.\.?(?:/|\?|$)") { return 400; }
