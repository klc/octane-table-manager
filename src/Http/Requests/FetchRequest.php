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
            'load_more' => 'nullable|boolean',
            'index' => 'nullable|string',
        ];
    }
}
