<?php

namespace KLC\OctaneTableManager\Http\Requests;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

// Swoole table keys are at most 63 bytes; Laravel's max:63 counts characters, and ş, ğ, ü... take 2 bytes.
class SwooleKey implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && strlen($value) > 63) {
            $fail('The :attribute may be at most 63 bytes; characters like ş take 2.');
        }
    }
}
