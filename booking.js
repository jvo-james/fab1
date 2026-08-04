import { sendSubmissionEmails, templateFor } from './email-service.js';
let firebaseReady = false;
let subscribeSlotLocks = null;
let subscribeAvailabilitySettings = null;
let getAdminDocument = null;

async function initialiseBookingPage() {
  try {
    const service = await import('./firebase-service.js');

    firebaseReady = Boolean(
      service.isFirebaseConfigured
    );

    subscribeSlotLocks =
      service.subscribeSlotLocks;

    subscribeAvailabilitySettings =
      service.subscribeAvailabilitySettings;


    getAdminDocument =
      service.getAdminDocument;
  } catch (error) {
    console.warn(
      'Firebase booking services could not be loaded.',
      error
    );
  }

  const form = document.querySelector(
    '#booking-form'
  );

  if (!form) {
    console.warn('Booking form was not found.');
    return;
  }

  const config = window.FAB_CONFIG || {};
  const paymentQuery = new URLSearchParams(window.location.search).get('payment');
  if (paymentQuery === 'cancelled') {
    setTimeout(() => showToast('Payment cancelled', 'No deposit was taken. Your slot is only reserved after the £25 Stripe payment is completed.'), 100);
    window.history.replaceState({}, document.title, window.location.pathname);
  }


  // Use the admin-managed service catalogue when one has been saved.
  if (getAdminDocument) {
    try {
      const catalogue = await getAdminDocument('settings', 'serviceCatalog');
      if (Array.isArray(catalogue?.services) && catalogue.services.length) {
        config.rates = Object.fromEntries(
          catalogue.services
            .filter((service) => service.active !== false)
            .map((service) => [service.id, {
              ...service,
              hourly: service.pricingType === 'hourly' ? Number(service.price) : service.hourly,
              fixed: service.pricingType === 'fixed' ? Number(service.price) : service.fixed,
              quoteOnly: service.pricingType === 'quote' || service.quoteOnly
            }])
        );
      }
    } catch (error) {
      console.warn('Admin service catalogue could not be loaded.', error);
    }
  }

  const rates = config.rates || {};

  let slots = Array.isArray(config.timeSlots)
    ? [...config.timeSlots]
    : [];

  let workingDays = Array.isArray(
    config.workingDays
  )
    ? [...config.workingDays]
    : [1, 2, 3, 4, 5];

  let openingStart = '06:00';
  let openingEnd = '23:00';

  const panels = [
    ...form.querySelectorAll('.booking-panel')
  ];

  const progress = [
    ...document.querySelectorAll(
      '.progress-step'
    )
  ];

  const calendarLabel =
    document.querySelector(
      '[data-calendar-label]'
    );

  const calendarGrid =
    document.querySelector(
      '[data-calendar-grid]'
    );

  const timeEmpty =
    document.querySelector(
      '[data-time-empty]'
    );

  const timeContent =
    document.querySelector(
      '[data-time-content]'
    );

  const selectedDateNode =
    document.querySelector(
      '[data-selected-date]'
    );

  const timeSlotList =
    document.querySelector(
      '[data-time-slots]'
    );

  const recurringNote =
    document.querySelector(
      '[data-recurring-note]'
    );

  const submitButton =
    form.querySelector(
      '[data-submit-booking]'
    );

  const statusNode =
    form.querySelector(
      '[data-booking-status]'
    );

  const successModal =
    document.querySelector(
      '#booking-success'
    );

  const successTitle =
    successModal?.querySelector(
      '[data-success-title]'
    );

  const successCopy =
    successModal?.querySelector(
      '[data-success-copy]'
    );

  const successAction =
    successModal?.querySelector(
      '[data-success-action]'
    );

  const summary = {
    service: document.querySelector(
      '[data-summary-service]'
    ),

    property: document.querySelector(
      '[data-summary-property]'
    ),

    frequency: document.querySelector(
      '[data-summary-frequency]'
    ),

    date: document.querySelector(
      '[data-summary-date]'
    ),

    time: document.querySelector(
      '[data-summary-time]'
    ),

    total: document.querySelector(
      '[data-summary-total]'
    ),

    hours: document.querySelector(
      '[data-summary-hours]'
    )
  };

  const paymentEstimateNode = document.querySelector('[data-payment-estimate]');

  let step = 0;
  let selectedDate = '';
  let selectedSlot = '';

  let calendarMonth = new Date();

  calendarMonth.setDate(1);
  calendarMonth.setHours(0, 0, 0, 0);

  let locks = new Map();

  let unsubscribeLocks = null;
  let unsubscribeSettings = null;

  let availabilityRequestId = 0;
  let postcodeTimer = null;

  const pad = (value) =>
    String(value).padStart(2, '0');

  const dateKey = (date) => {
    return (
      `${date.getFullYear()}-` +
      `${pad(date.getMonth() + 1)}-` +
      `${pad(date.getDate())}`
    );
  };

  const parseDateKey = (value) => {
    return new Date(`${value}T12:00:00`);
  };

  const today = () => {
    const value = new Date();

    value.setHours(0, 0, 0, 0);

    return value;
  };

  const selectedValue = (name) => {
    return (
      form.querySelector(
        `[name="${name}"]:checked`
      )?.value || ''
    );
  };

  const selectedLabel = (name) => {
    return (
      form.querySelector(
        `[name="${name}"]:checked`
      )?.dataset.label || ''
    );
  };

  const roundHalf = (value) => {
    return Math.ceil(value * 2) / 2;
  };

  const money = (value) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0
    }).format(value);
  };

  function showToast(title, message) {
    if (
      typeof window.FAB_showToast ===
      'function'
    ) {
      window.FAB_showToast(
        title,
        message
      );

      return;
    }

    console.warn(`${title}: ${message}`);
  }

  function selectedRegion() {
    const postcode = String(
      form.elements.postcode?.value || ''
    )
      .toUpperCase()
      .replace(/\s+/g, '');

    return /^(M|OL|BL|SK)/.test(postcode)
      ? 'greater-manchester'
      : 'london-luton';
  }

  function lockId(day, slotId) {
    return (
      `${selectedRegion()}_` +
      `${day}_` +
      `${slotId}`
    );
  }


  function timeToMinutes(value) {
    const [hours, minutes] = String(value || '').split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? (hours * 60) + minutes : NaN;
  }

  function normaliseExactTimeSlots(input) {
    if (!Array.isArray(input)) return [];

    const unique = new Map();

    input.forEach((slot) => {
      const start = String(slot?.start || slot?.label || '').trim();

      // Ignore legacy broad periods such as morning/afternoon/evening.
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return;

      const startMinutes = timeToMinutes(start);
      const endMinutes = startMinutes + 30;
      const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

      unique.set(start, {
        id: start.replace(':', '-'),
        label: start,
        start,
        end
      });
    });

    return [...unique.values()].sort((a, b) => a.start.localeCompare(b.start));
  }

  function requiredSlotsForStart(startSlot, hours) {
    const requiredMinutes = Math.max(30, Math.ceil(Number(hours || 0) * 60 / 30) * 30);
    const startMinutes = timeToMinutes(startSlot.start);
    const endMinutes = startMinutes + requiredMinutes;
    return activeSlots().filter(slot => {
      const slotStart = timeToMinutes(slot.start);
      return slotStart >= startMinutes && slotStart < endMinutes;
    });
  }

  function startTimeIsAvailable(day, startSlot, hours) {
    const required = requiredSlotsForStart(startSlot, hours);
    const requiredMinutes = Math.max(30, Math.ceil(Number(hours || 0) * 60 / 30) * 30);
    return required.length === requiredMinutes / 30 && required.every(slot => slotIsAvailable(day, slot));
  }

  function lockIsActive(lock) {
    if (!lock) {
      return false;
    }

    if (
      lock.status === 'hold' &&
      lock.expiresAt
    ) {
      const expiry =
        typeof lock.expiresAt.toDate ===
        'function'
          ? lock.expiresAt.toDate()
          : new Date(lock.expiresAt);

      return expiry > new Date();
    }

    return [
      'blocked',
      'booked',
      'paid',
      'confirmed',
      'requested',
      'hold'
    ].includes(lock.status);
  }

  function activeSlots() {
    return slots.filter((slot) => {
      return (
        slot.start >= openingStart &&
        slot.end <= openingEnd
      );
    });
  }

  /*
   * Important availability behaviour:
   *
   * 1. Missing Firestore records use the normal
   *    working-day availability.
   *
   * 2. An explicit "available" record is open.
   *
   * 3. Blocked, booked, paid, confirmed,
   *    requested and active holds are closed.
   */
  function slotIsAvailable(day, slot) {
    const lock = locks.get(
      lockId(day, slot.id)
    );

    // Only slots explicitly opened by the admin are bookable.
    if (!lock) {
      return false;
    }

    if (lock.status === 'available') {
      return true;
    }

    if (lockIsActive(lock)) {
      return false;
    }

    return ![
      'blocked',
      'booked',
      'paid',
      'confirmed',
      'requested'
    ].includes(lock.status);
  }

  function availableSlotsForDate(day) {
    const hours = Number(form.dataset.hours || estimateBooking().hours || 0);
    return activeSlots().filter((slot) => startTimeIsAvailable(day, slot, hours));
  }

  function displaySlot(day, slot) {
    const lock = locks.get(
      lockId(day, slot.id)
    );

    if (lock?.status === 'available') {
      return {
        ...slot,
        start: lock.start || slot.start,
        end: lock.end || slot.end
      };
    }

    return slot;
  }

  function dateIsAvailable(date) {
    if (date < today()) {
      return false;
    }

    return (
      availableSlotsForDate(
        dateKey(date)
      ).length > 0
    );
  }

  function estimateBooking() {
    const serviceKey =
      selectedValue('service');

    const service =
      rates[serviceKey];

    const frequency =
      selectedValue('frequency') ||
      'once';

    const bedrooms = Number(
      form.elements.bedrooms?.value || 1
    );

    const bathrooms = Number(
      form.elements.bathrooms?.value || 1
    );

    let baseHours =
      2 +
      Math.max(0, bedrooms - 1) * 0.6 +
      Math.max(0, bathrooms - 1) * 0.5;

    if (serviceKey === 'deep') {
      baseHours *= 1.45;
    }

    if (serviceKey === 'tenancy') {
      baseHours *= 1.75;
    }

    if (serviceKey === 'holiday') {
      baseHours = Math.max(
        2,
        baseHours * 1.05
      );
    }

    if (serviceKey === 'oven') {
      baseHours = 1;
    }

    const addOnHours = [
      ...form.querySelectorAll(
        '[name="addons"]:checked'
      )
    ].reduce((total, input) => {
      const values = {
        inside_fridge: 0.5,
        inside_cabinets: 0.75,
        interior_windows: 0.75,
        ironing: 1
      };

      return (
        total +
        (values[input.value] || 0)
      );
    }, 0);

    const hours = service
      ? Math.max(
          service.minimumHours || 0,
          roundHalf(
            baseHours + addOnHours
          )
        )
      : 0;

    let total = null;

    if (
      service &&
      !service.quoteOnly
    ) {
      if (service.fixed) {
        total = service.fixed;
      } else if (service.hourly) {
        total = Math.round(
          service.hourly * hours
        );
      }
    }

    const baseSlot = slots.find(
      (slot) =>
        slot.id === selectedSlot
    );

    const shownSlot =
      baseSlot && selectedDate
        ? displaySlot(
            selectedDate,
            baseSlot
          )
        : baseSlot;

    if (summary.service) {
      summary.service.textContent =
        service?.name ||
        'Not selected';
    }

    if (summary.property) {
      summary.property.textContent =
        `${bedrooms} bed · ` +
        `${bathrooms} bath`;
    }

    if (summary.frequency) {
      summary.frequency.textContent =
        selectedLabel('frequency') ||
        'One time';
    }

    if (summary.date) {
      summary.date.textContent =
        selectedDate
          ? parseDateKey(
              selectedDate
            ).toLocaleDateString(
              'en-GB',
              {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
              }
            )
          : 'Choose date';
    }

    if (summary.time) {
      summary.time.textContent =
        shownSlot ? `${shownSlot.start} start` : 'Choose time';
    }

    if (summary.total) {
      if (!service) {
        summary.total.textContent =
          'Select a service';
      } else if (total === null) {
        summary.total.textContent =
          'Tailored quote';
      } else {
        summary.total.textContent =
          `About ${money(total)}`;
      }
    }

    if (summary.hours) {
      if (!service) {
        summary.hours.textContent =
          'Duration shown after service selection';
      } else if (service.quoteOnly) {
        summary.hours.textContent =
          'We will price this after reviewing the item details';
      } else if (service.fixed) {
        summary.hours.textContent =
          'Fixed starting price';
      } else {
        summary.hours.textContent =
          `Estimated ${hours} hours at ` +
          `${money(service.hourly)}/hr`;
      }
    }

    form.dataset.estimate =
      total === null
        ? ''
        : String(total);

    form.dataset.hours =
      String(hours);

    form.dataset.frequency =
      frequency;

    if (paymentEstimateNode) {
      paymentEstimateNode.textContent = total === null ? 'Tailored quote required' : `About ${money(total)} (guidance only)`;
    }

    return {
      serviceKey,
      service,
      frequency,
      bedrooms,
      bathrooms,
      hours,
      total
    };
  }

  function markValidity(
    field,
    valid
  ) {
    field.classList.toggle(
      'invalid',
      !valid
    );

    field.setAttribute(
      'aria-invalid',
      valid ? 'false' : 'true'
    );
  }

  function validatePanel(index) {
    const panel = panels[index];

    if (!panel) {
      return false;
    }

    const required = [
      ...panel.querySelectorAll(
        '[required]'
      )
    ];

    const checkedGroups =
      new Set();

    let valid = true;
    let firstInvalid = null;

    for (const field of required) {
      if (field.disabled) {
        continue;
      }

      let okay = true;

      if (field.type === 'radio') {
        if (
          checkedGroups.has(
            field.name
          )
        ) {
          continue;
        }

        checkedGroups.add(
          field.name
        );

        okay = Boolean(
          form.querySelector(
            `[name="${field.name}"]:checked`
          )
        );
      } else if (
        field.type === 'hidden'
      ) {
        okay = Boolean(field.value);
      } else if (
        field.type === 'checkbox'
      ) {
        okay = field.checked;
      } else {
        okay =
          field.checkValidity();

        markValidity(
          field,
          okay
        );
      }

      if (!okay) {
        valid = false;
        firstInvalid ||= field;
      }
    }

    if (
      index === 1 &&
      form.elements.postcode
    ) {
      const postcode =
        form.elements.postcode;

      const value =
        postcode.value.trim();

      const covered =
        typeof window.FAB_AREA
          ?.postcodeCovered ===
        'function'
          ? window.FAB_AREA
              .postcodeCovered(value)
          : /^(M|OL|BL|SK|LU|E|EC|N|NW|SE|SW|W|WC)\d/i.test(
              value
            );

      const error =
        form.querySelector(
          '[data-postcode-error]'
        );

      if (!covered) {
        valid = false;
        firstInvalid ||= postcode;

        markValidity(
          postcode,
          false
        );

        if (error) {
          error.hidden = false;
        }
      } else {
        markValidity(
          postcode,
          true
        );

        if (error) {
          error.hidden = true;
        }
      }
    }

    if (!valid) {
      showToast(
        'Complete this step',
        'Please choose or enter the required details before continuing.'
      );

      if (
        firstInvalid &&
        firstInvalid.type !==
          'hidden'
      ) {
        firstInvalid.focus({
          preventScroll: true
        });

        firstInvalid.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }

    return valid;
  }

  function setStep(next) {
    step = Math.max(
      0,
      Math.min(
        panels.length - 1,
        next
      )
    );

    panels.forEach(
      (panel, index) => {
        const active =
          index === step;

        panel.classList.toggle(
          'active',
          active
        );

        panel.hidden = !active;

        panel.setAttribute(
          'aria-hidden',
          active
            ? 'false'
            : 'true'
        );
      }
    );

    progress.forEach(
      (item, index) => {
        item.classList.toggle(
          'active',
          index === step
        );

        item.classList.toggle(
          'complete',
          index < step
        );

        if (index === step) {
          item.setAttribute(
            'aria-current',
            'step'
          );
        } else {
          item.removeAttribute(
            'aria-current'
          );
        }
      }
    );

    estimateBooking();

    const scrollTarget =
      document.querySelector(
        window.innerWidth < 760
          ? '.booking-progress'
          : '.form-shell'
      );

    scrollTarget?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  function monthBounds(date) {
    const start = new Date(
      date.getFullYear(),
      date.getMonth(),
      1
    );

    const end = new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0
    );

    return {
      startKey: dateKey(start),
      endKey: dateKey(end)
    };
  }

  function localLocksForMonth(
    startKey,
    endKey
  ) {
    try {
      const saved = JSON.parse(
        localStorage.getItem(
          'fab-admin-slot-locks'
        ) || '{}'
      );

      const bookings = JSON.parse(
        localStorage.getItem(
          'fab-bookings'
        ) || '[]'
      );

      const map = new Map();

      Object.entries(saved).forEach(
        ([id, value]) => {
          if (
            value.date >= startKey &&
            value.date <= endKey
          ) {
            map.set(id, {
              id,
              ...value
            });
          }
        }
      );

      bookings.forEach(
        (booking) => {
          if (
            booking.date >= startKey &&
            booking.date <= endKey &&
            booking.time_slot
          ) {
            const id =
              `${booking.region ||
                selectedRegion()}_` +
              `${booking.date}_` +
              `${booking.time_slot}`;

            map.set(id, {
              id,
              date: booking.date,
              slotId:
                booking.time_slot,
              status: 'booked'
            });
          }
        }
      );

      return map;
    } catch (error) {
      console.warn(
        'Local availability could not be read.',
        error
      );

      return new Map();
    }
  }

  async function loadMonthAvailability() {
    const requestId =
      ++availabilityRequestId;

    const {
      startKey,
      endKey
    } = monthBounds(
      calendarMonth
    );

    if (
      typeof unsubscribeLocks ===
      'function'
    ) {
      unsubscribeLocks();
    }

    unsubscribeLocks = null;

    if (
      firebaseReady &&
      typeof subscribeSlotLocks ===
        'function'
    ) {
      try {
        unsubscribeLocks =
          await subscribeSlotLocks(
            startKey,
            endKey,
            (next) => {
              if (
                requestId !==
                availabilityRequestId
              ) {
                return;
              }

              locks =
                next instanceof Map
                  ? next
                  : new Map();

              if (
                selectedDate &&
                !availableSlotsForDate(
                  selectedDate
                ).length
              ) {
                clearScheduleSelection();
              }

              renderCalendar();

              if (selectedDate) {
                renderTimeSlots(
                  selectedDate
                );
              }
            },
            (error) => {
              console.warn(
                'Live availability was interrupted.',
                error
              );
            }
          );

        return;
      } catch (error) {
        console.warn(
          'Using local availability fallback.',
          error
        );
      }
    }

    locks = localLocksForMonth(
      startKey,
      endKey
    );

    renderCalendar();

    if (selectedDate) {
      renderTimeSlots(
        selectedDate
      );
    }
  }

  function renderCalendar() {
    if (
      !calendarLabel ||
      !calendarGrid
    ) {
      return;
    }

    calendarLabel.textContent =
      calendarMonth.toLocaleDateString(
        'en-GB',
        {
          month: 'long',
          year: 'numeric'
        }
      );

    calendarGrid.innerHTML = '';

    const first = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      1
    );

    const last = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth() + 1,
      0
    );

    const leading =
      (first.getDay() + 6) % 7;

    for (
      let index = 0;
      index < leading;
      index += 1
    ) {
      const blank =
        document.createElement(
          'span'
        );

      blank.className =
        'calendar-day outside';

      blank.setAttribute(
        'aria-hidden',
        'true'
      );

      calendarGrid.append(blank);
    }

    const todayKey =
      dateKey(new Date());

    for (
      let day = 1;
      day <= last.getDate();
      day += 1
    ) {
      const date = new Date(
        calendarMonth.getFullYear(),
        calendarMonth.getMonth(),
        day
      );

      const key = dateKey(date);

      const available =
        dateIsAvailable(date);

      const button =
        document.createElement(
          'button'
        );

      button.type = 'button';
      button.className =
        'calendar-day';

      button.textContent =
        String(day);

      button.dataset.date = key;
      button.disabled = !available;

      button.classList.toggle(
        'has-space',
        available
      );

      button.classList.toggle(
        'selected',
        key === selectedDate
      );

      button.classList.toggle(
        'today',
        key === todayKey
      );

      button.setAttribute(
        'aria-pressed',
        key === selectedDate
          ? 'true'
          : 'false'
      );

      button.setAttribute(
        'aria-label',
        date.toLocaleDateString(
          'en-GB',
          {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          }
        )
      );

      button.addEventListener(
        'click',
        () => {
          selectDate(key);
        }
      );

      calendarGrid.append(button);
    }
  }

  function clearScheduleSelection() {
    selectedDate = '';
    selectedSlot = '';

    if (form.elements.date) {
      form.elements.date.value = '';
    }

    if (
      form.elements.time_slot
    ) {
      form.elements.time_slot.value =
        '';
    }

    if (timeEmpty) {
      timeEmpty.hidden = false;
    }

    if (timeContent) {
      timeContent.hidden = true;
    }

    updateRecurringMessage();
    estimateBooking();
  }

  function selectDate(key) {
    selectedDate = key;
    selectedSlot = '';

    if (form.elements.date) {
      form.elements.date.value = key;
    }

    if (
      form.elements.time_slot
    ) {
      form.elements.time_slot.value =
        '';
    }

    renderCalendar();
    renderTimeSlots(key);
    estimateBooking();
  }

  function renderTimeSlots(key) {
    if (
      !timeEmpty ||
      !timeContent ||
      !selectedDateNode ||
      !timeSlotList
    ) {
      return;
    }

    timeEmpty.hidden = true;
    timeContent.hidden = false;

    selectedDateNode.textContent =
      parseDateKey(
        key
      ).toLocaleDateString(
        'en-GB',
        {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }
      );

    timeSlotList.innerHTML = '';

    const visibleSlots =
      activeSlots();

    if (!visibleSlots.length) {
      const message =
        document.createElement('p');

      message.className =
        'time-slot-empty';

      message.textContent =
        'No start times have been configured.';

      timeSlotList.append(message);

      return;
    }

    let availableCount = 0;

    const estimatedHours = Number(form.dataset.hours || estimateBooking().hours || 0);

    visibleSlots.forEach((slot) => {
      const available = startTimeIsAvailable(key, slot, estimatedHours);

      if (available) {
        availableCount += 1;
      }

      if (!available) {
        return;
      }

      const shown = displaySlot(
        key,
        slot
      );

      const label =
        document.createElement(
          'label'
        );

      label.className =
        'time-slot';

      const input =
        document.createElement(
          'input'
        );

      input.type = 'radio';
      input.name = 'calendar_slot';
      input.value = slot.id;
      input.checked =
        selectedSlot === slot.id;

      const visual =
        document.createElement(
          'span'
        );

      const title =
        document.createElement('b');

      title.textContent = shown.start;

      const details =
        document.createElement(
          'small'
        );

      details.textContent = `Estimated ${estimatedHours || 0.5} hour${estimatedHours === 1 ? '' : 's'}`;

      visual.append(
        title,
        details
      );

      label.append(
        input,
        visual
      );

      input.addEventListener(
        'change',
        () => {
          if (
            !input.checked ||
            input.disabled
          ) {
            return;
          }

          selectedSlot = slot.id;

          if (
            form.elements.time_slot
          ) {
            form.elements.time_slot
              .value = slot.id;
          }

          updateRecurringMessage();
          estimateBooking();
        }
      );

      timeSlotList.append(label);
    });

    if (!availableCount) {
      selectedSlot = '';

      if (
        form.elements.time_slot
      ) {
        form.elements.time_slot.value =
          '';
      }

      const message =
        document.createElement('p');

      message.className =
        'time-slot-empty';

      message.textContent =
        'No start times can fit the estimated cleaning duration on this date. Please choose another date.';

      timeSlotList.prepend(message);
    }

    updateRecurringMessage();
  }

  function updateRecurringMessage() {
    if (!recurringNote) {
      return;
    }

    const frequency =
      selectedValue('frequency');

    if (
      !selectedDate ||
      !frequency ||
      frequency === 'once'
    ) {
      recurringNote.hidden = true;
      return;
    }

    const words = {
      weekly: 'weekly',
      fortnightly:
        'fortnightly',
      monthly: 'monthly'
    };

    const slot = slots.find(
      (item) =>
        item.id === selectedSlot
    );

    const node =
      recurringNote.querySelector(
        'span'
      );

    recurringNote.hidden = false;

    if (!node) {
      return;
    }

    if (
      selectedSlot &&
      slot
    ) {
      node.textContent =
        `The ${slot.start} start time will be requested as ` +
        `your regular ` +
        `${words[frequency] ||
          frequency} time.`;
    } else {
      node.textContent =
        'Choose a start time for ' +
        `your regular ` +
        `${words[frequency] ||
          frequency} booking.`;
    }
  }

  async function loadAvailabilitySettings() {
    const apply = (settings) => {
      if (!settings) {
        return;
      }

      if (
        Array.isArray(
          settings.workingDays
        ) &&
        settings.workingDays.length
      ) {
        workingDays =
          settings.workingDays.map(
            Number
          );
      }

      // The booking page always uses the canonical exact-time list from
      // config.js. Firestore settings control working days/opening hours,
      // while slotLocks control which individual dates and times are open.
      // This prevents stale or partially saved admin settings from hiding
      // every date on the public calendar.
      slots = normaliseExactTimeSlots(config.timeSlots);

      openingStart =
        settings.start ||
        openingStart;

      openingEnd =
        settings.end ||
        openingEnd;

      renderCalendar();

      if (selectedDate) {
        renderTimeSlots(
          selectedDate
        );
      }
    };

    if (
      firebaseReady &&
      typeof subscribeAvailabilitySettings ===
        'function'
    ) {
      try {
        unsubscribeSettings =
          await subscribeAvailabilitySettings(
            apply
          );

        return;
      } catch (error) {
        console.warn(
          'Firebase availability settings could not be loaded.',
          error
        );
      }
    }

    try {
      const settings = JSON.parse(
        localStorage.getItem(
          'fab-availability-settings'
        ) || 'null'
      );

      apply(settings);
    } catch (error) {
      console.warn(
        'Local availability settings could not be read.',
        error
      );
    }
  }

  function createReference() {
    const timePart = Date.now()
      .toString()
      .slice(-7);

    const randomPart = Math.random()
      .toString(36)
      .slice(2, 5)
      .toUpperCase();

    return (
      `FAB-${timePart}-` +
      `${randomPart}`
    );
  }

  function saveLocalBooking(data) {
    let rows = [];

    try {
      rows = JSON.parse(
        localStorage.getItem(
          'fab-bookings'
        ) || '[]'
      );
    } catch (error) {
      console.warn(
        'Old local bookings could not be read.',
        error
      );
    }

    rows.push({
      ...data,
      status: 'preview_request'
    });

    localStorage.setItem(
      'fab-bookings',
      JSON.stringify(
        rows.slice(-100)
      )
    );
  }

  function openFallbackConfirmation(
    data,
    estimate
  ) {
    const slot = slots.find(
      (item) =>
        item.id === data.time_slot
    );

    const message = [
      "Hi FAUSTINA'S SPARKLY SERVICES, I would like to request this booking:",

      `Reference: ${data.reference}`,

      `Name: ${
        data.first_name || ''
      } ${
        data.last_name || ''
      }`,

      `Service: ${
        estimate.service?.name ||
        data.service
      }`,

      `Frequency: ${
        selectedLabel(
          'frequency'
        ) ||
        data.frequency ||
        'One time'
      }`,

      `Date: ${data.date}`,

      `Start time: ${slot ? slot.start : data.time_slot}`,

      `Property: ${
        data.property_type || ''
      }, ${
        data.bedrooms || ''
      } bedroom(s), ${
        data.bathrooms || ''
      } bathroom(s)`,

      `Postcode: ${
        data.postcode || ''
      }`,

      `Address: ${
        data.address || ''
      }`,

      estimate.total === null
        ? 'Price: tailored quote requested'
        : `Estimated price: ${money(
            estimate.total
          )}`,

      data.notes
        ? `Notes: ${data.notes}`
        : ''
    ]
      .filter(Boolean)
      .join('\n');

    if (successTitle) {
      successTitle.textContent =
        'Your booking details are ready.';
    }

    if (successCopy) {
      successCopy.textContent =
        'Contact the team on WhatsApp if secure payment is unavailable.';
    }

    if (successAction) {
      successAction.textContent =
        'Contact on WhatsApp';

      successAction.href =
        `https://wa.me/` +
        `${config.whatsappNumber || ''}` +
        `?text=${encodeURIComponent(
          message
        )}`;

      successAction.target =
        '_blank';

      successAction.rel =
        'noopener';
    }

    successModal?.classList.add(
      'open'
    );
  }

  form
    .querySelectorAll('[data-next]')
    .forEach((button) => {
      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault();

          const panel =
            button.closest(
              '.booking-panel'
            );

          const index =
            panels.indexOf(panel);

          if (
            index >= 0 &&
            validatePanel(index)
          ) {
            setStep(index + 1);
          }
        }
      );
    });

  form
    .querySelectorAll('[data-back]')
    .forEach((button) => {
      button.addEventListener(
        'click',
        (event) => {
          event.preventDefault();

          const panel =
            button.closest(
              '.booking-panel'
            );

          const index =
            panels.indexOf(panel);

          if (index >= 0) {
            setStep(index - 1);
          }
        }
      );
    });

  form.addEventListener(
    'change',
    () => {
      estimateBooking();
      updateRecurringMessage();
    }
  );

  form.addEventListener(
    'input',
    (event) => {
      const field =
        event.target;

      if (
        field instanceof
          HTMLElement &&
        field.classList.contains(
          'invalid'
        )
      ) {
        field.classList.remove(
          'invalid'
        );

        field.setAttribute(
          'aria-invalid',
          'false'
        );
      }

      estimateBooking();
    }
  );

  form.elements.postcode
    ?.addEventListener(
      'input',
      () => {
        clearTimeout(
          postcodeTimer
        );

        clearScheduleSelection();

        postcodeTimer =
          setTimeout(() => {
            loadMonthAvailability()
              .catch((error) => {
                console.warn(
                  'Availability could not be refreshed.',
                  error
                );
              });
          }, 250);
      }
    );

  document
    .querySelector(
      '[data-calendar-prev]'
    )
    ?.addEventListener(
      'click',
      () => {
        const previous = new Date(
          calendarMonth.getFullYear(),
          calendarMonth.getMonth() - 1,
          1
        );

        const current = today();
        current.setDate(1);

        if (previous < current) {
          return;
        }

        calendarMonth = previous;

        clearScheduleSelection();

        loadMonthAvailability()
          .catch((error) => {
            console.warn(
              'Previous month could not be loaded.',
              error
            );
          });
      }
    );

  document
    .querySelector(
      '[data-calendar-next]'
    )
    ?.addEventListener(
      'click',
      () => {
        const next = new Date(
          calendarMonth.getFullYear(),
          calendarMonth.getMonth() + 1,
          1
        );

        const max = today();

        max.setDate(1);

        max.setMonth(
          max.getMonth() + 6
        );

        if (next > max) {
          return;
        }

        calendarMonth = next;

        clearScheduleSelection();

        loadMonthAvailability()
          .catch((error) => {
            console.warn(
              'Next month could not be loaded.',
              error
            );
          });
      }
    );

  form.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const activeIndex = panels.findIndex((panel) => panel.classList.contains('active'));
      const panelIndex = activeIndex < 0 ? panels.length - 1 : activeIndex;
      if (!validatePanel(panelIndex)) return;

      const estimate = estimateBooking();
      const data = Object.fromEntries(new FormData(form).entries());
      data.addons = [...form.querySelectorAll('[name="addons"]:checked')].map((input) => input.value);
      data.estimate = estimate.total;
      data.estimatedHours = estimate.hours;
      data.region = selectedRegion();
      data.reference = createReference();
      data.depositAmount = Number(config.depositAmount || 25);

      const chosenSlot = slots.find(slot => slot.id === data.time_slot);
      const chosenIsAvailable = chosenSlot && startTimeIsAvailable(data.date, chosenSlot, estimate.hours);
      if (!chosenIsAvailable) {
        if (statusNode) {
          statusNode.textContent = 'That slot was just taken. Please return to the calendar and choose another time.';
          statusNode.className = 'form-status error';
        }
        await loadMonthAvailability().catch(() => {});
        return;
      }

      if (submitButton) submitButton.disabled = true;
      const submitLabel = submitButton?.querySelector('span');
      if (submitLabel) submitLabel.textContent = 'Opening secure payment…';
      if (statusNode) {
        statusNode.textContent = 'Creating your secure Stripe payment…';
        statusNode.className = 'form-status';
      }

      try {
        const response = await fetch(config.netlifyCheckoutEndpoint || '/.netlify/functions/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.checkoutUrl) {
          throw new Error(result.error || 'CHECKOUT_FAILED');
        }
        window.location.assign(result.checkoutUrl);
      } catch (error) {
        console.error('Stripe checkout could not be started:', error);
        if (statusNode) {
          statusNode.textContent = error?.message === 'SLOT_UNAVAILABLE'
            ? 'That slot is no longer available. Please choose another time.'
            : 'We could not open secure payment. Please try again or contact the team.';
          statusNode.className = 'form-status error';
        }
        await loadMonthAvailability().catch(() => {});
        if (submitButton) submitButton.disabled = false;
        if (submitLabel) submitLabel.textContent = 'Pay £25 deposit';
      }
    }
  );

  const propertyType =
    form.querySelector(
      '#property-type'
    );

  const propertyOther =
    form.querySelector(
      '#property-other'
    );

  function updatePropertyOther() {
    if (
      !propertyType ||
      !propertyOther
    ) {
      return;
    }

    const show =
      propertyType.value ===
      'Other';

    propertyOther.hidden = !show;
    propertyOther.required = show;

    if (!show) {
      propertyOther.value = '';
      propertyOther.classList.remove(
        'invalid'
      );
    }
  }

  propertyType?.addEventListener(
    'change',
    updatePropertyOther
  );

  const otherAddon =
    form.querySelector(
      '[data-other-addon]'
    );

  const otherAddonInput =
    form.querySelector(
      '[name="addon_other"]'
    );

  function updateOtherAddon() {
    if (
      !otherAddon ||
      !otherAddonInput
    ) {
      return;
    }

    const show =
      otherAddon.checked;

    otherAddonInput.hidden = !show;
    otherAddonInput.required = show;

    if (!show) {
      otherAddonInput.value = '';

      otherAddonInput.classList.remove(
        'invalid'
      );
    }
  }

  otherAddon?.addEventListener(
    'change',
    updateOtherAddon
  );

  document
    .querySelectorAll(
      '[data-close-modal]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        () => {
          button
            .closest(
              '.modal-backdrop'
            )
            ?.classList.remove(
              'open'
            );
        }
      );
    });

  successModal?.addEventListener(
    'click',
    (event) => {
      if (
        event.target ===
        successModal
      ) {
        successModal.classList.remove(
          'open'
        );
      }
    }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape'
      ) {
        successModal?.classList.remove(
          'open'
        );
      }
    }
  );

  const params =
    new URLSearchParams(
      window.location.search
    );

  for (const name of [
    'service',
    'frequency'
  ]) {
    const value =
      params.get(name);

    if (!value) {
      continue;
    }

    const input = [
      ...form.querySelectorAll(
        `[name="${name}"]`
      )
    ].find(
      (item) =>
        item.value === value
    );

    if (input) {
      input.checked = true;
    }
  }

  updatePropertyOther();
  updateOtherAddon();
  estimateBooking();
  setStep(0);

  await loadAvailabilitySettings();
  await loadMonthAvailability();

  window.addEventListener(
    'beforeunload',
    () => {
      if (
        typeof unsubscribeLocks ===
        'function'
      ) {
        unsubscribeLocks();
      }

      if (
        typeof unsubscribeSettings ===
        'function'
      ) {
        unsubscribeSettings();
      }
    },
    {
      once: true
    }
  );
}

if (
  document.readyState ===
  'loading'
) {
  document.addEventListener(
    'DOMContentLoaded',
    initialiseBookingPage,
    {
      once: true
    }
  );
} else {
  initialiseBookingPage();
}
