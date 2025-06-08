<?php

namespace KLC\OctaneTableManager\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class DeleteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'table' => 'required|string',
            'index' => 'required|string',
        ];
    }
}
