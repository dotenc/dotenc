document.documentElement.classList.add("js")

// Native content remains available when JavaScript is disabled.
const tabs = [...document.querySelectorAll('[role="tab"]')]
const panels = [...document.querySelectorAll('[role="tabpanel"]')]
/**
 * Select an install method and synchronize panel visibility and keyboard focus order.
 * @param {Element} selected The tab whose associated panel should be displayed.
 */
function selectTab(selected) {
	for (const tab of tabs) {
		const active = tab === selected
		tab.setAttribute("aria-selected", String(active))
		tab.tabIndex = active ? 0 : -1
	}
	for (const panel of panels) {
		panel.hidden = panel.id !== selected.getAttribute("aria-controls")
	}
}
for (const [index, tab] of tabs.entries()) {
	tab.addEventListener("click", () => selectTab(tab))
	tab.addEventListener("keydown", (event) => {
		let next
		if (event.key === "ArrowRight") next = (index + 1) % tabs.length
		if (event.key === "ArrowLeft")
			next = (index - 1 + tabs.length) % tabs.length
		if (event.key === "Home") next = 0
		if (event.key === "End") next = tabs.length - 1
		if (next === undefined) return
		event.preventDefault()
		selectTab(tabs[next])
		tabs[next].focus()
	})
}
if (tabs.length) selectTab(tabs[0])

const copyStatus = document.getElementById("copy-status")
for (const button of document.querySelectorAll(".copy-button")) {
	button.hidden = false
	let resetTimer
	button.addEventListener("click", async () => {
		clearTimeout(resetTimer)
		try {
			await navigator.clipboard.writeText(button.dataset.copy)
			button.textContent = "Copied ✓"
			copyStatus.textContent = "Install command copied to clipboard."
		} catch {
			button.textContent = "Try again"
			copyStatus.textContent =
				"Could not copy. Select and copy the command manually."
		}
		resetTimer = setTimeout(() => {
			button.textContent = "Copy ⧉"
			copyStatus.textContent = ""
		}, 2500)
	})
}

const menuToggle = document.getElementById("menu-toggle")
const navigation = document.getElementById("primary-nav")
const mobileMenu = document.getElementById("mobile-menu")
if (menuToggle && navigation && mobileMenu) {
	const desktopParent = navigation.parentElement
	const mobileSlot = mobileMenu.querySelector(".drawer-navigation")
	const mobileLayout = window.matchMedia("(max-width: 900px)")
	let scrollPosition = 0
	let backdropPressed = false
	menuToggle.hidden = false

	/** Restore page scrolling and the toggle state when the native dialog closes. */
	function restorePage() {
		document.body.classList.remove("menu-open")
		document.body.style.removeProperty("top")
		window.scrollTo({ top: scrollPosition, behavior: "instant" })
		menuToggle.setAttribute("aria-expanded", "false")
	}

	/** Close before link navigation so restoring scroll cannot override its destination. */
	function closeMenu() {
		if (!mobileMenu.open) return
		mobileMenu.close()
		restorePage()
	}

	/** Reuse the same navigation links across desktop and the mobile modal. */
	function syncNavigation() {
		closeMenu()
		if (mobileLayout.matches) mobileSlot.append(navigation)
		else desktopParent.append(navigation)
	}

	menuToggle.addEventListener("click", () => {
		if (!mobileLayout.matches) return
		scrollPosition = window.scrollY
		document.body.style.top = `-${scrollPosition}px`
		document.body.classList.add("menu-open")
		mobileMenu.showModal()
		menuToggle.setAttribute("aria-expanded", "true")
	})
	mobileMenu.querySelector(".drawer-close").addEventListener("click", closeMenu)
	mobileMenu.addEventListener("cancel", (event) => {
		event.preventDefault()
		closeMenu()
	})
	mobileMenu.addEventListener("keydown", (event) => {
		if (event.key !== "Tab") return
		const controls = [
			...mobileMenu.querySelectorAll("a[href], button:not(:disabled)"),
		]
		const first = controls[0]
		const last = controls[controls.length - 1]
		if (
			event.shiftKey &&
			(document.activeElement === first ||
				document.activeElement === mobileMenu.querySelector(".drawer-shell"))
		) {
			event.preventDefault()
			last.focus()
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault()
			first.focus()
		}
	})
	mobileMenu.addEventListener("pointerdown", (event) => {
		backdropPressed = event.target === mobileMenu
	})
	mobileMenu.addEventListener("click", (event) => {
		if (backdropPressed && event.target === mobileMenu) closeMenu()
		backdropPressed = false
	})
	for (const link of mobileMenu.querySelectorAll("a")) {
		link.addEventListener("click", closeMenu)
	}
	for (const link of navigation.querySelectorAll("a")) {
		link.addEventListener("click", closeMenu)
	}
	mobileLayout.addEventListener("change", syncNavigation)
	syncNavigation()
}
