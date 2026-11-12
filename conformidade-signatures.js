(function () {
  'use strict';

  const form = document.getElementById('compliance-form');
  if (!form) return;

  const people = [];
  const labels = { student: 'aluno', guardian: 'responsável' };
  const inkWidth = 4;

  function isDrawing(person) {
    return person.drawOption.checked && Boolean(person.context);
  }

  function syncName(person) {
    const value = person.nameInput.value.trim().replace(/\s+/g, ' ');
    person.namePreview.textContent = value || person.nameFallback;
    person.namePreview.hidden = false;
  }

  function setStatus(person) {
    if (!person.context) {
      person.status.textContent = 'O desenho não está disponível neste navegador. Você pode assinar no papel.';
    } else if (!isDrawing(person)) {
      person.status.textContent = 'A linha do ' + person.label + ' ficará livre para assinar no papel.';
    } else if (person.hasInk) {
      person.status.textContent = 'Assinatura do ' + person.label + ' pronta no termo abaixo.';
    } else {
      person.status.textContent = 'Desenhe na área branca. A assinatura aparecerá na linha do ' + person.label + '.';
    }
  }

  // The canvas keeps a fixed logical size. CSS resizing never erases its pixels.
  function pointFromEvent(person, event) {
    const rect = person.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const inset = inkWidth / 2;
    return {
      x: Math.max(inset, Math.min(person.canvas.width - inset,
        (event.clientX - rect.left) * person.canvas.width / rect.width)),
      y: Math.max(inset, Math.min(person.canvas.height - inset,
        (event.clientY - rect.top) * person.canvas.height / rect.height))
    };
  }

  function drawTo(person, point) {
    if (!point || !person.lastPoint) return;
    const context = person.context;
    context.beginPath();
    context.moveTo(person.lastPoint.x, person.lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    person.lastPoint = point;
  }

  function updatePreview(person) {
    person.image.hidden = true;
    if (!person.context || !person.hasInk) {
      person.image.removeAttribute('src');
      setStatus(person);
      return;
    }

    try {
      const width = person.canvas.width;
      const height = person.canvas.height;
      const pixels = person.context.getImageData(0, 0, width, height).data;
      let left = width;
      let top = height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (pixels[(y * width + x) * 4 + 3] === 0) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }

      if (right < left || bottom < top) {
        person.hasInk = false;
        person.clearButton.disabled = true;
        person.image.removeAttribute('src');
        setStatus(person);
        return;
      }

      // Copy only the ink bounds, keeping a transparent margin around the stroke.
      const padding = 10;
      left = Math.max(0, left - padding);
      top = Math.max(0, top - padding);
      right = Math.min(width - 1, right + padding);
      bottom = Math.min(height - 1, bottom + padding);
      const cropped = document.createElement('canvas');
      cropped.width = right - left + 1;
      cropped.height = bottom - top + 1;
      const croppedContext = cropped.getContext('2d');
      if (!croppedContext) throw new Error('Canvas indisponível');
      croppedContext.drawImage(person.canvas, left, top, cropped.width,
        cropped.height, 0, 0, cropped.width, cropped.height);
      const source = cropped.toDataURL('image/png');
      if (person.image.getAttribute('src') !== source) person.image.src = source;
      person.image.hidden = !isDrawing(person);
      setStatus(person);
    } catch (error) {
      person.image.removeAttribute('src');
      person.status.textContent = 'Não foi possível preparar o desenho. Limpe e tente novamente ou escolha assinar no papel.';
    }
  }

  function finishStroke(person, event) {
    if (person.pointerId === null) return;
    if (event && event.pointerId !== person.pointerId) return;
    if (event && event.type === 'pointerup') {
      drawTo(person, pointFromEvent(person, event));
    }
    const pointerId = person.pointerId;
    person.pointerId = null;
    person.lastPoint = null;
    try {
      if (person.canvas.hasPointerCapture(pointerId)) {
        person.canvas.releasePointerCapture(pointerId);
      }
    } catch (error) {
      // The browser may already have released a canceled or finished pointer.
    }
    updatePreview(person);
  }

  function syncMode(person) {
    finishStroke(person);
    person.pad.hidden = !isDrawing(person);
    person.image.hidden = !isDrawing(person) || !person.hasInk || !person.image.getAttribute('src');
    setStatus(person);
  }

  function clearSignature(person) {
    finishStroke(person);
    if (person.context) {
      person.context.clearRect(0, 0, person.canvas.width, person.canvas.height);
    }
    person.hasInk = false;
    person.image.hidden = true;
    person.image.removeAttribute('src');
    person.clearButton.disabled = true;
    setStatus(person);
  }

  form.querySelectorAll('[data-signature]').forEach(function (card) {
    const key = card.dataset.signature;
    const canvas = card.querySelector('[data-signature-canvas]');
    let context = null;
    try {
      context = canvas.getContext('2d');
    } catch (error) {
      // A browser without canvas support still offers the paper option.
    }
    const person = {
      key: key,
      label: labels[key],
      canvas: canvas,
      context: context,
      drawOption: card.querySelector('input[value="draw"]'),
      pad: card.querySelector('[data-signature-pad]'),
      clearButton: card.querySelector('[data-signature-clear]'),
      status: card.querySelector('[data-signature-status]'),
      image: form.querySelector('[data-signature-image="' + key + '"]'),
      nameInput: form.querySelector('[name="' + key + '"]'),
      namePreview: form.querySelector('[data-signature-name="' + key + '"]'),
      nameFallback: key === 'student' ? 'Assinatura' : 'Nome e assinatura',
      pointerId: null,
      lastPoint: null,
      hasInk: false
    };
    people.push(person);
    person.drawOption.disabled = !context;
    if (context) {
      context.lineWidth = inkWidth;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#111111';
      context.fillStyle = '#111111';
    }

    card.querySelectorAll('input[type="radio"]').forEach(function (option) {
      option.addEventListener('change', function () { syncMode(person); });
    });
    person.clearButton.addEventListener('click', function () { clearSignature(person); });
    person.nameInput.addEventListener('input', function () { syncName(person); });
    person.nameInput.addEventListener('change', function () { syncName(person); });

    canvas.addEventListener('pointerdown', function (event) {
      if (!isDrawing(person) || person.pointerId !== null || event.isPrimary === false || event.button !== 0) return;
      const point = pointFromEvent(person, event);
      if (!point) return;
      event.preventDefault();
      person.pointerId = event.pointerId;
      person.lastPoint = point;
      context.beginPath();
      context.arc(point.x, point.y, inkWidth / 2, 0, Math.PI * 2);
      context.fill();
      person.hasInk = true;
      person.clearButton.disabled = false;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // Window pointerup also ends a stroke if capture is not available.
      }
    }, { passive: false });

    canvas.addEventListener('pointermove', function (event) {
      if (person.pointerId !== event.pointerId) return;
      event.preventDefault();
      let samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      if (!samples.length) samples = [event];
      samples.forEach(function (sample) { drawTo(person, pointFromEvent(person, sample)); });
    }, { passive: false });

    canvas.addEventListener('pointerup', function (event) { finishStroke(person, event); });
    canvas.addEventListener('pointercancel', function (event) { finishStroke(person, event); });
    canvas.addEventListener('lostpointercapture', function (event) { finishStroke(person, event); });
    window.addEventListener('pointerup', function (event) { finishStroke(person, event); });
    window.addEventListener('pointercancel', function (event) { finishStroke(person, event); });
    syncName(person);
    syncMode(person);
  });

  function prepareDocument() {
    people.forEach(function (person) {
      finishStroke(person);
      syncName(person);
      updatePreview(person);
    });
  }

  form.addEventListener('submit', function (event) { event.preventDefault(); });
  form.addEventListener('reset', function () {
    people.forEach(clearSignature);
    // The native reset updates input and radio values after the reset event.
    queueMicrotask(function () {
      people.forEach(function (person) { syncName(person); syncMode(person); });
    });
  });
  document.getElementById('print-document').addEventListener('click', function () {
    prepareDocument();
    window.print();
  });
  document.getElementById('clear-document').addEventListener('click', function () {
    form.reset();
    form.querySelector('[name="student"]').focus();
  });
  window.addEventListener('beforeprint', prepareDocument);
}());
