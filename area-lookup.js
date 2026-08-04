(() => {
  const config = window.FAB_CONFIG || {};

  const serviceTowns =
    config.serviceAreaTowns ||
    config.serviceAreas ||
    [];

  const allowedTowns = new Set(
    serviceTowns.map((town) =>
      String(town).trim().toUpperCase()
    )
  );

  /*
   * These are postcode prefixes, not a suggestion list.
   * They are used only as a quick fallback if the postcode API
   * is temporarily unavailable.
   */
  const allowedPrefixes =
    config.postcodePrefixes || [
      'M',
      'OL',
      'BL',
      'SK',
      'LU',
      'E',
      'EC',
      'N',
      'NW',
      'SE',
      'SW',
      'W',
      'WC'
    ];

  const suggestionControllers = new WeakMap();
  const debounceTimers = new WeakMap();

  function normalise(value = '') {
    return String(value)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  }

  function compactPostcode(value = '') {
    return normalise(value).replace(/\s+/g, '');
  }

  function outwardCode(value = '') {
    const normalised = normalise(value);

    if (!normalised) {
      return '';
    }

    return normalised.split(' ')[0];
  }

  function formatPostcode(value = '') {
    const compact = compactPostcode(value);

    if (compact.length <= 3) {
      return compact;
    }

    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }

  function townMatch(value = '') {
    return allowedTowns.has(normalise(value));
  }

  function postcodePrefixMatch(value = '') {
    const compact = compactPostcode(value);

    return allowedPrefixes.some((prefix) => {
      const upperPrefix = String(prefix).toUpperCase();

      if (!compact.startsWith(upperPrefix)) {
        return false;
      }

      /*
       * Prevent E from incorrectly matching EC postcodes,
       * W from incorrectly matching WC, and similar overlaps.
       */
      const nextCharacter = compact.charAt(
        upperPrefix.length
      );

      return (
        !nextCharacter ||
        /\d/.test(nextCharacter)
      );
    });
  }

  function resultIsInServiceArea(result) {
    if (!result) {
      return false;
    }

    const locationValues = [
      result.post_town,
      result.admin_district,
      result.parish,
      result.admin_ward,
      result.region
    ]
      .filter(Boolean)
      .map((value) =>
        normalise(value)
      );

    if (
      locationValues.some((value) =>
        allowedTowns.has(value)
      )
    ) {
      return true;
    }

    /*
     * Salford, Stockport, Bolton and Oldham can be returned
     * through different Postcodes.io administrative fields.
     */
    const serviceAreaNames = [
      'MANCHESTER',
      'SALFORD',
      'STOCKPORT',
      'BOLTON',
      'OLDHAM',
      'LUTON',
      'LONDON'
    ];

    if (
      locationValues.some((value) =>
        serviceAreaNames.some(
          (area) =>
            value === area ||
            value.includes(area)
        )
      )
    ) {
      return true;
    }

    return postcodePrefixMatch(
      result.postcode || ''
    );
  }

  async function lookupExactPostcode(
    postcode,
    signal
  ) {
    const compact = compactPostcode(postcode);

    if (!compact) {
      return null;
    }

    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(
        compact
      )}`,
      {
        signal
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    return data.status === 200
      ? data.result
      : null;
  }

  async function searchPostcodes(
    query,
    signal
  ) {
    const response = await fetch(
      `https://api.postcodes.io/postcodes?q=${encodeURIComponent(
        query
      )}&limit=20`,
      {
        signal
      }
    );

    if (!response.ok) {
      throw new Error(
        'Postcode search failed.'
      );
    }

    const data = await response.json();

    return Array.isArray(data.result)
      ? data.result
      : [];
  }

  function createSuggestionsBox(input) {
    const existing =
      input.parentElement?.querySelector(
        '.postcode-suggestions'
      );

    if (existing) {
      return existing;
    }

    const box =
      document.createElement('div');

    box.className =
      'postcode-suggestions';

    box.hidden = true;

    box.setAttribute(
      'role',
      'listbox'
    );

    box.setAttribute(
      'aria-label',
      'Postcode suggestions'
    );

    input.parentElement?.appendChild(box);

    return box;
  }

  function hideSuggestions(box) {
    box.hidden = true;
    box.innerHTML = '';
  }

  function setAreaError(
    input,
    show,
    message =
      'We’re not here yet, but we’ll expand soon.'
  ) {
    const field =
      input.closest('.field');

    const error =
      field?.querySelector(
        '[data-postcode-error]'
      );

    if (error) {
      error.textContent = message;
      error.hidden = !show;
    }

    input.classList.toggle(
      'invalid',
      show
    );

    input.setAttribute(
      'aria-invalid',
      show ? 'true' : 'false'
    );
  }

  function markPostcodeStatus(
    input,
    status
  ) {
    input.dataset.areaVerified =
      status;
  }

  function showSuggestions(
    input,
    box,
    results
  ) {
    const uniqueResults = [];
    const seen = new Set();

    results.forEach((result) => {
      const postcode = formatPostcode(
        result.postcode || ''
      );

      if (!postcode || seen.has(postcode)) {
        return;
      }

      seen.add(postcode);

      uniqueResults.push({
        postcode,
        town:
          result.post_town ||
          result.admin_district ||
          '',
        covered:
          resultIsInServiceArea(result)
      });
    });

    if (!uniqueResults.length) {
      hideSuggestions(box);
      return;
    }

    box.innerHTML = '';

    uniqueResults
      .slice(0, 12)
      .forEach((result) => {
        const button =
          document.createElement('button');

        button.type = 'button';
        button.dataset.postcode =
          result.postcode;

        button.dataset.covered =
          String(result.covered);

        button.setAttribute(
          'role',
          'option'
        );

        const postcodeText =
          document.createElement('b');

        postcodeText.textContent =
          result.postcode;

        const locationText =
          document.createElement('small');

        locationText.textContent =
          result.town ||
          'United Kingdom';

        button.append(
          postcodeText,
          locationText
        );

        box.appendChild(button);
      });

    box.hidden = false;
  }

  async function validatePostcode(
    input,
    options = {}
  ) {
    const {
      showIncompleteError = false
    } = options;

    const value =
      input.value.trim();

    if (!value) {
      markPostcodeStatus(
        input,
        'false'
      );

      setAreaError(
        input,
        false
      );

      return false;
    }

    const compact =
      compactPostcode(value);

    /*
     * Full UK postcode length normally falls between
     * five and seven characters without spaces.
     */
    if (
      compact.length < 5 ||
      compact.length > 7
    ) {
      markPostcodeStatus(
        input,
        'false'
      );

      setAreaError(
        input,
        showIncompleteError,
        'Please enter a complete UK postcode.'
      );

      return false;
    }

    const previousController =
      suggestionControllers.get(input);

    previousController?.abort();

    const controller =
      new AbortController();

    suggestionControllers.set(
      input,
      controller
    );

    try {
      const result =
        await lookupExactPostcode(
          compact,
          controller.signal
        );

      if (!result) {
        markPostcodeStatus(
          input,
          'false'
        );

        setAreaError(
          input,
          true,
          'Please enter a valid UK postcode.'
        );

        return false;
      }

      input.value = formatPostcode(
        result.postcode
      );

      const covered =
        resultIsInServiceArea(result);

      markPostcodeStatus(
        input,
        covered ? 'true' : 'false'
      );

      setAreaError(
        input,
        !covered
      );

      input.dispatchEvent(
        new CustomEvent(
          'postcodevalidated',
          {
            bubbles: true,
            detail: {
              covered,
              result
            }
          }
        )
      );

      return covered;
    } catch (error) {
      if (
        error.name === 'AbortError'
      ) {
        return false;
      }

      console.warn(
        'The postcode could not be verified online.',
        error
      );

      /*
       * Network fallback. This does not create suggestions;
       * it only prevents the form from completely failing
       * when the API is unavailable.
       */
      const covered =
        postcodePrefixMatch(value);

      markPostcodeStatus(
        input,
        covered ? 'true' : 'false'
      );

      setAreaError(
        input,
        !covered
      );

      return covered;
    }
  }

  function enhancePostcodeInput(input) {
    if (
      !input ||
      input.dataset.postcodeEnhanced ===
        'true'
    ) {
      return;
    }

    input.dataset.postcodeEnhanced =
      'true';

    /*
     * Remove any hard-coded HTML datalist.
     */
    input.removeAttribute('list');

    /*
     * Keep browser autofill available for users who have
     * saved their own address, while Postcodes.io supplies
     * the live UK postcode suggestions.
     */
    input.setAttribute(
      'autocomplete',
      'postal-code'
    );

    input.setAttribute(
      'autocapitalize',
      'characters'
    );

    input.setAttribute(
      'spellcheck',
      'false'
    );

    input.setAttribute(
      'aria-autocomplete',
      'list'
    );

    const box =
      createSuggestionsBox(input);

    input.addEventListener(
      'input',
      () => {
        const previousTimer =
          debounceTimers.get(input);

        clearTimeout(previousTimer);

        markPostcodeStatus(
          input,
          'false'
        );

        setAreaError(
          input,
          false
        );

        const query =
          input.value.trim();

        if (query.length < 2) {
          hideSuggestions(box);
          return;
        }

        const timer = setTimeout(
          async () => {
            const previousController =
              suggestionControllers.get(
                input
              );

            previousController?.abort();

            const controller =
              new AbortController();

            suggestionControllers.set(
              input,
              controller
            );

            try {
              const results =
                await searchPostcodes(
                  query,
                  controller.signal
                );

              showSuggestions(
                input,
                box,
                results
              );
            } catch (error) {
              if (
                error.name !==
                'AbortError'
              ) {
                console.warn(
                  'Postcode suggestions could not be loaded.',
                  error
                );
              }

              hideSuggestions(box);
            }
          },
          250
        );

        debounceTimers.set(
          input,
          timer
        );
      }
    );

    box.addEventListener(
      'mousedown',
      (event) => {
        /*
         * Prevent blur from closing the list before
         * the selected option is processed.
         */
        event.preventDefault();
      }
    );

    box.addEventListener(
      'click',
      async (event) => {
        const button =
          event.target.closest(
            'button[data-postcode]'
          );

        if (!button) {
          return;
        }

        input.value =
          button.dataset.postcode || '';

        hideSuggestions(box);

        await validatePostcode(
          input,
          {
            showIncompleteError: true
          }
        );

        input.dispatchEvent(
          new Event('change', {
            bubbles: true
          })
        );
      }
    );

    input.addEventListener(
      'blur',
      () => {
        setTimeout(() => {
          hideSuggestions(box);
        }, 150);

        validatePostcode(input, {
          showIncompleteError: false
        });
      }
    );

    input.addEventListener(
      'change',
      () => {
        validatePostcode(input, {
          showIncompleteError: true
        });
      }
    );
  }

  /*
   * Add live postcode suggestions to both the booking page
   * and the separate location checker.
   */
  enhancePostcodeInput(
    document.querySelector(
      '#postcode'
    )
  );

  enhancePostcodeInput(
    document.querySelector(
      '#location-postcode'
    )
  );

  window.FAB_AREA = {
    normalise,
    compactPostcode,
    formatPostcode,
    outward: outwardCode,
    townMatch,
    postcodeCovered:
      postcodePrefixMatch,
    covered:
      postcodePrefixMatch,
    validatePostcode,
    resultIsInServiceArea
  };
})();
