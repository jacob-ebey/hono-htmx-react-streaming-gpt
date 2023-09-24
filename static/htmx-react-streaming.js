;(function () {
	/** @type {import('htmx.org').HtmxExtension} */
	var api

	htmx.defineExtension('react-streaming', {
		init: function (apiRef) {
			api = apiRef
			console.log(api)
		},

		onEvent: function (name, evt) {
			switch (name) {
				case 'htmx:beforeProcessNode': {
					// biome-ignore lint/correctness/noInnerDeclarations: <explanation>
					var parent = evt.target

					forEach(
						queryAttributeOnThisOrChildren(parent, 'react-stream'),
						function (child) {
							ensureReactStreamSend(child)
						},
					)
					break
				}
			}
		},
	})

	/**
	 * ensureReactStreamSend attaches trigger handles to elements with
	 * "react-streaming" attribute
	 * @param {HTMLElement} elt
	 */
	function ensureReactStreamSend(node) {
		var nodeData = api.getInternalData(node)
		var triggerSpecs = api.getTriggerSpecs(node)
		triggerSpecs.forEach(function (ts) {
			api.addTriggerHandler(node, ts, nodeData, function (elt, evt) {
				var headers = api.getHeaders(node, api.getTarget(node))
				var inputValues = api.getInputValues(node, 'post')
				var errors = inputValues.errors

				console.log({ headers, errors })

				const action = node.getAttribute('react-stream')
				if (!action) return

				if (errors && errors.length > 0) {
					api.triggerEvent(elt, 'htmx:validation:halted', errors)
					return
				}

				const formData = makeFormData(inputValues.values)
				if (
					// biome-ignore lint/complexity/useOptionalChain: <explanation>
					nodeData.lastButtonClicked &&
					nodeData.lastButtonClicked.hasAttribute('name')
				) {
					formData.append(
						nodeData.lastButtonClicked.getAttribute('name'),
						nodeData.lastButtonClicked.getAttribute('value') || '',
					)
				}

				submitStreamingForm(node, action, formData, headers)
				evt.preventDefault()
			})
		})
	}

	/**
	 *
	 * @param {string} action
	 * @param {FormData} formData
	 * @param {unknown} headers
	 */
	async function submitStreamingForm(node, action, formData, headers) {
		var oobTarget = api.getAttributeValue(node, 'hx-swap-oob')
		var oobTargetSplit = oobTarget.split(':')
		oobTarget = oobTargetSplit[0]
		var selector = oobTargetSplit[1]
		if (oobTarget !== 'beforeend')
			throw new Error('Only before end targets are supported at the moment')

		var response = await fetch(action, {
			body: formData,
			method: 'POST',
			headers,
			credentials: 'same-origin',
		})

		var stream = response.body
		if (!stream) return

		var newDocument = document.implementation.createHTMLDocument()
		newDocument.write('<streaming-element>')
		var newElement = newDocument.querySelector('streaming-element')

		for (var selected of document.querySelectorAll(selector)) {
			selected.appendChild(newElement)
		}

		const decoder = new TextDecoder()
		const reader = stream.getReader()
		let read = await reader.read()
		while (!read.done) {
			const chunk = decoder.decode(read.value, { stream: true })
			newDocument.write(chunk)
			read = await reader.read()
		}
		newDocument.write(decoder.decode())
		newDocument.write('</streaming-element>')
		newDocument.close()
		newElement.parentElement.removeChild(newElement)
	}

	/**
	 * queryAttributeOnThisOrChildren returns all nodes that contain the requested attributeName, INCLUDING THE PROVIDED ROOT ELEMENT.
	 *
	 * @param {HTMLElement} elt
	 * @param {string} attributeName
	 */
	function queryAttributeOnThisOrChildren(elt, attributeName) {
		var result = []

		// If the parent element also contains the requested attribute, then add it to the results too.
		if (
			api.hasAttribute(elt, attributeName) ||
			api.hasAttribute(elt, 'react-streaming')
		) {
			result.push(elt)
		}

		// Search all child nodes that match the requested attribute
		elt
			.querySelectorAll(
				// biome-ignore lint/style/useTemplate: <explanation>
				'[' + attributeName + '], [data-' + attributeName + '], [react-stream]',
			)
			.forEach(function (node) {
				result.push(node)
			})

		return result
	}

	/**
	 * @template T
	 * @param {T[]} arr
	 * @param {(T) => void} func
	 */
	function forEach(arr, func) {
		if (arr) {
			// biome-ignore lint/correctness/noInnerDeclarations: <explanation>
			for (var i = 0; i < arr.length; i++) {
				func(arr[i])
			}
		}
	}

	/**
	 *
	 * @param {Object} values
	 * @returns
	 */
	function makeFormData(values) {
		var formData = new FormData()
		for (var name in values) {
			// biome-ignore lint/suspicious/noPrototypeBuiltins: <explanation>
			if (values.hasOwnProperty(name)) {
				// biome-ignore lint/correctness/noInnerDeclarations: <explanation>
				var value = values[name]
				if (Array.isArray(value)) {
					forEach(value, function (v) {
						formData.append(name, v)
					})
				} else {
					formData.append(name, value)
				}
			}
		}
		return formData
	}

	function tryExecuteScript(node) {
		try {
			eval(node.innerHTML)
		} catch (error) {
			const observer = new MutationObserver((mutations) => {
				try {
					eval(node.innerHTML)
					observer.disconnect()
				} catch (error) {}
			})
			observer.observe(node, { childList: true })
		}
	}

	class StreamingElement extends HTMLElement {
		constructor() {
			super()
			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					if (!mutation.addedNodes) continue
					for (var node of mutation.addedNodes) {
						if (node.nodeName === 'SCRIPT') {
							this.lastScript = node
							continue
						}
						if (this.lastScript) {
							tryExecuteScript(this.lastScript)
							this.lastScript = null
						}
						this.parentElement.insertBefore(node, this)
					}
				}
			})
			observer.observe(this, { childList: true })
		}
		disconnectedCallback() {
			if (this.lastScript) {
				tryExecuteScript(this.lastScript)
				this.lastScript = null
			}
		}
	}
	customElements.define('streaming-element', StreamingElement)
})()
