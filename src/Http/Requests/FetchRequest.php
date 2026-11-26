<?php

namespace KLC\OctaneTableManager\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class FetchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'table' => 'required|string',
            'offset' => 'nullable|integer|min:0',
            'index' => 'nullable|string|max:63',
            'column' => 'nullable|string',
            'value' => 'nullable|string',
        ];
    }
}
