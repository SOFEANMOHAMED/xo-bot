# Guard Service

نظام حماية لجودة الردود - يمنع المقالات الطويلة والهلوسة (hallucinations).

## المميزات

1. **Length Check**: يضمن أن الرد <= 120 كلمة (trim if needed)
2. **Question Check**: يضمن سؤال واحد فقط (count '?' and '؟')
3. **Number Validation**: يمنع الأرقام المختلقة (compare with toolResults/policies)

## API

### guardReply

```typescript
const result = guardReply({
  replyText: string,
  plan: SalesPlan,
  toolResults?: ToolResult[],
  merchantPolicies?: {
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    storeCurrency?: string;
  }
});

// Returns:
{
  passed: boolean;
  replyText: string; // Cleaned/fixed reply
  violations: string[];
  warnings: string[];
}
```

## Checks

### 1. Length Check (<= 120 words)

```typescript
const wordCount = countWords(replyText);
if (wordCount > 120) {
  // Trim to 120 words
  replyText = trimToMaxWords(replyText, 120);
}
```

**Algorithm:**
- Count words (Arabic and English)
- If > 120, trim to first 120 words
- Try to end at sentence boundary
- If not possible, add ellipsis

### 2. Question Check (Exactly ONE)

```typescript
const questionCount = countQuestions(replyText);
if (questionCount === 0) {
  // Add planned question
  replyText += ' ' + plan.one_question;
} else if (questionCount > 1) {
  // Keep only planned question
  replyText = keepOnlyPlannedQuestion(replyText, plan.one_question);
}
```

**Algorithm:**
- Count '?' and '؟' marks
- If 0: Add `plan.one_question`
- If > 1: Keep only planned question, remove extras
- If planned question not found: Keep first question

### 3. Number Validation (No Hallucinations)

```typescript
const numbersInReply = extractNumbers(replyText);
const allowedNumbers = extractAllowedNumbers(toolResults, merchantPolicies);

const suspiciousNumbers = numbersInReply.filter(num => {
  if (num <= 10) return false; // Allow small numbers (quantities)
  return !allowedNumbers.has(num); // Check if in allowed set
});

if (suspiciousNumbers.length > 0) {
  // Remove sentences containing suspicious numbers
  suspiciousNumbers.forEach(num => {
    replyText = removeNumberSentence(replyText, num);
  });
}
```

**Algorithm:**
1. Extract all numbers from reply
2. Extract allowed numbers from:
   - `toolResults` (product prices, stock, quantities)
   - `merchantPolicies` (shipping costs, delivery days)
3. Filter suspicious numbers:
   - Numbers > 10 (small numbers are allowed - likely quantities)
   - Not in allowed set
4. Remove sentences containing suspicious numbers
5. If too much removed, just remove numbers themselves

## Number Extraction

### From Reply
- Matches: `\d+`, `[\d٠-٩]+` (Arabic numerals)
- Converts Arabic numerals to regular numbers
- Returns array of numbers

### From ToolResults
- Extracts from `products[].price`
- Extracts from `products[].stock`
- Extracts from `products[].quantity`
- Extracts from direct numeric fields

### From MerchantPolicies
- Extracts from `shippingPolicy` text
- Extracts from `deliveryTime` text
- Uses same number extraction algorithm

## Integration

### In Orchestrator

```typescript
// After generating reply with Hybrid Writer
const guardResult = guardReply({
  replyText,
  plan: salesPlan,
  toolResults,
  merchantPolicies: {
    shippingPolicy: merchantPolicies.shippingPolicy,
    deliveryTime: merchantPolicies.deliveryTime,
    paymentMethods: merchantPolicies.paymentMethods,
    returnPolicy: merchantPolicies.returnPolicy,
    storeCurrency: merchantPolicies.storeCurrency || 'USD'
  }
});

replyText = guardResult.replyText;

if (!guardResult.passed) {
  logger.warn('Guard checks failed', {
    violations: guardResult.violations,
    warnings: guardResult.warnings
  });
}
```

## Examples

### Example 1: Normal Reply (Passes)
```typescript
Input: "سعر الهاتف هو 500 دولار. هل تريد المتابعة مع الطلب؟"
ToolResults: [{ products: [{ price: 500 }] }]
Result: ✅ Passed, no changes
```

### Example 2: Too Long (Trimmed)
```typescript
Input: "مرحباً بك في متجرنا. نحن نقدم مجموعة واسعة..." (150 words)
Result: ⚠️ Trimmed to 120 words
```

### Example 3: Multiple Questions (Fixed)
```typescript
Input: "هل تريد معرفة المزيد؟ هل تريد الطلب الآن؟"
Plan: { one_question: "هل تريد معرفة المزيد؟" }
Result: ⚠️ Removed extra question, kept planned one
```

### Example 4: Hallucinated Number (Removed)
```typescript
Input: "سعر الهاتف هو 500 دولار. التوصيل يكلف 999 دولار."
ToolResults: [{ products: [{ price: 500 }] }]
Result: ⚠️ Removed sentence with hallucinated number (999)
```

### Example 5: Allowed Number from Policies (Passes)
```typescript
Input: "التوصيل متاح خلال 3-5 أيام عمل."
MerchantPolicies: { deliveryTime: "التوصيل خلال 3-5 أيام عمل" }
Result: ✅ Passed (numbers from policies are allowed)
```

## Testing

```bash
npm run test-guard
```

## Test Cases

1. **Normal Reply** - Should pass all checks
2. **Too Long** - Should trim to 120 words
3. **Multiple Questions** - Should keep only planned question
4. **No Question** - Should add planned question
5. **Hallucinated Number** - Should remove sentence
6. **Allowed Number from Policies** - Should pass
7. **Small Numbers** - Should pass (quantities)
8. **Multiple Issues** - All should be fixed

## Logging

Guard service logs:
- Original length, word count, question count
- Violations and warnings
- Final length, word count, question count
- Numbers extracted and allowed numbers

## Future Enhancements

1. **Better Number Matching**: Fuzzy matching for prices (within tolerance)
2. **Context-Aware Trimming**: Preserve important sentences
3. **Regeneration**: If too much removed, regenerate with "fix-only" prompt
4. **Language Detection**: Better handling of mixed Arabic/English
5. **Advanced Question Detection**: Detect implicit questions

