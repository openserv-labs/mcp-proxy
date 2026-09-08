/* eslint-env browser */
/* global document, window, localStorage, sessionStorage, alert, confirm */
// biome-ignore lint/style/useTemplate: allow string concatenation for legacy code
// biome-ignore lint/complexity/noForEach: allow forEach for legacy code

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const adminTokenInput = document.getElementById('adminToken')
  const adminTokenError = document.getElementById('adminTokenError')
  const applicationNameInput = document.getElementById('applicationName')
  const loadToolsButton = document.getElementById('loadTools')
  const applicationNameError = document.getElementById('applicationNameError')
  const applicationContainer = document.getElementById('applicationContainer')
  const backendUrlInput = document.getElementById('backendUrl')
  const saveBackendUrlButton = document.getElementById('saveBackendUrl')
  const backendUrlError = document.getElementById('backendUrlError')
  const toolsContainer = document.getElementById('toolsContainer')
  const toolsList = document.getElementById('toolsList')
  const addToolButton = document.getElementById('addToolButton')
  const toolModal = document.getElementById('toolModal')
  const modalTitle = document.getElementById('modalTitle')
  const closeModal = document.getElementById('closeModal')
  const cancelModal = document.getElementById('cancelModal')
  const saveToolButton = document.getElementById('saveToolButton')
  const toolForm = document.getElementById('toolForm')
  const toolName = document.getElementById('toolName')
  const toolDescription = document.getElementById('toolDescription')
  const toolNameError = document.getElementById('toolNameError')
  const toolDescriptionError = document.getElementById('toolDescriptionError')
  const parametersContainer = document.getElementById('parametersContainer')
  const addParameterButton = document.getElementById('addParameterButton')

  // State
  let tools = []
  let editingToolName = null

  // Event Listeners
  loadToolsButton.addEventListener('click', loadApplicationAndTools)
  saveBackendUrlButton.addEventListener('click', saveApplicationProfile)
  addToolButton.addEventListener('click', () => showModal())
  closeModal.addEventListener('click', hideModal)
  cancelModal.addEventListener('click', hideModal)
  saveToolButton.addEventListener('click', saveTool)
  addParameterButton.addEventListener('click', addParameter)

  // Load Application Name from localStorage if available
  const savedApplicationName = localStorage.getItem('mcpAdminApplicationName')
  if (savedApplicationName) {
    applicationNameInput.value = savedApplicationName
  }

  const savedAdminToken = sessionStorage.getItem('mcpAdminToken')
  if (savedAdminToken) {
    adminTokenInput.value = savedAdminToken
  }

  adminTokenInput.addEventListener('input', () => {
    adminTokenError.textContent = ''
  })

  async function adminFetch(url, options = {}) {
    const adminToken = adminTokenInput.value.trim()

    if (!adminToken) {
      adminTokenError.textContent = 'Admin token is required'
      throw new Error('Admin token is required')
    }

    adminTokenError.textContent = ''

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + adminToken,
        'X-Application-Name': applicationNameInput.value.trim(),
        ...(options.headers || {})
      }
    })

    if (response.status === 401) {
      sessionStorage.removeItem('mcpAdminToken')
      adminTokenError.textContent = 'Invalid admin token'
      throw new Error('Invalid admin token')
    }

    if (response.status === 503) {
      adminTokenError.textContent =
        'The admin API is disabled: the server has no valid ADMIN_TOKEN configured'
      throw new Error('Admin API is disabled')
    }

    if (response.ok) {
      sessionStorage.setItem('mcpAdminToken', adminToken)
    }

    return response
  }

  // Generate unique ID
  function generateId() {
    return 'param_' + Math.random().toString(36).substring(2, 11)
  }

  // Load application and tools
  async function loadApplicationAndTools() {
    const applicationName = applicationNameInput.value.trim()

    if (!applicationName) {
      applicationNameError.textContent = 'Application Name is required'
      return
    }

    applicationNameError.textContent = ''

    try {
      // First load application profile
      const applicationResponse = await adminFetch('/admin/api/application', { method: 'GET' })

      if (!applicationResponse.ok) {
        const errorData = await applicationResponse.json()
        throw new Error(errorData.error || 'Failed to load application profile')
      }

      const applicationData = await applicationResponse.json()
      backendUrlInput.value = applicationData.backendUrl || ''

      // Show application container
      applicationContainer.style.display = 'block'

      // Then load tools
      const toolsResponse = await adminFetch('/admin/api/tools', { method: 'GET' })

      if (!toolsResponse.ok) {
        const errorData = await toolsResponse.json()
        throw new Error(errorData.error || 'Failed to load tools')
      }

      tools = await toolsResponse.json()
      renderTools()
      toolsContainer.style.display = 'flex'

      // Save Application Name for next time
      localStorage.setItem('mcpAdminApplicationName', applicationName)
    } catch (error) {
      applicationNameError.textContent = error.message
      applicationContainer.style.display = 'none'
      toolsContainer.style.display = 'none'
    }
  }

  // Save application profile
  async function saveApplicationProfile() {
    const backendUrl = backendUrlInput.value.trim()

    // Clear previous errors
    backendUrlError.textContent = ''

    try {
      const response = await adminFetch('/admin/api/application', {
        method: 'POST',
        body: JSON.stringify({ backendUrl })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save configuration')
      }

      // Show success message briefly
      const successMessage = document.createElement('p')
      successMessage.textContent = 'Configuration saved successfully'
      successMessage.style.color = 'green'
      successMessage.style.marginTop = '8px'

      // Remove any existing success message
      const existingMessage = document.querySelector('.success-message')
      if (existingMessage) {
        existingMessage.remove()
      }

      successMessage.className = 'success-message'
      saveBackendUrlButton.insertAdjacentElement('afterend', successMessage)

      setTimeout(() => {
        successMessage.remove()
      }, 3000)
    } catch (error) {
      if (error.message.includes('URL')) {
        backendUrlError.textContent = error.message
      } else {
        // Generic error, show next to the save button
        const errorMessage = document.createElement('p')
        errorMessage.textContent = error.message
        errorMessage.style.color = '#ff4d4f'
        errorMessage.style.marginTop = '8px'

        const existingMessage = document.querySelector('.error-message')
        if (existingMessage) {
          existingMessage.remove()
        }

        errorMessage.className = 'error-message'
        saveBackendUrlButton.insertAdjacentElement('afterend', errorMessage)
      }
    }
  }

  // Render tools table
  function renderTools() {
    toolsList.innerHTML = ''

    if (tools.length === 0) {
      const row = document.createElement('tr')
      row.innerHTML =
        '<td colspan="4" style="text-align: center;">No tools found. Add a new tool to get started.</td>'
      toolsList.appendChild(row)
      return
    }

    tools.forEach(tool => {
      const row = document.createElement('tr')

      const parametersHtml = (tool.parameters || [])
        .map(param => {
          return `<div class="parameter-card"><strong>${param.name}</strong> (${param.type}): ${param.description || '-'}</div>`
        })
        .join('')

      row.innerHTML = `
        <td>${tool.name}</td>
        <td>${tool.description}</td>
        <td>${parametersHtml}</td>
        <td>
          <div class="icons-container">
            <button class="button" onclick="editTool('${tool.name}')">Edit</button>
            <button class="button button-danger" onclick="deleteTool('${tool.name}')">Delete</button>
          </div>
        </td>
      `

      toolsList.appendChild(row)
    })
  }

  // Show modal for adding/editing a tool
  function showModal(toolToEdit = null) {
    clearFormErrors()

    if (toolToEdit) {
      const tool = tools.find(t => t.name === toolToEdit)
      if (tool) {
        editingToolName = tool.name
        modalTitle.textContent = 'Edit Tool'
        toolName.value = tool.name
        toolName.disabled = true
        toolDescription.value = tool.description

        // Clear parameters
        parametersContainer.innerHTML = ''

        // Add existing parameters
        ;(tool.parameters || []).forEach(param => {
          addParameter(param)
        })
      }
    } else {
      editingToolName = null
      modalTitle.textContent = 'Add New Tool'
      toolForm.reset()
      toolName.disabled = false
      parametersContainer.innerHTML = ''
    }

    toolModal.style.display = 'block'
  }

  // Hide modal
  function hideModal() {
    toolModal.style.display = 'none'
    clearFormErrors()
  }

  // Add parameter field
  function addParameter(param = null) {
    const parameterId = generateId()
    const paramDiv = document.createElement('div')
    paramDiv.className = 'parameter-card'
    paramDiv.dataset.id = parameterId

    paramDiv.innerHTML = `
      <div class="flex flex-between flex-align-center gap-small">
        <input type="text" class="input" name="paramName" placeholder="Param Name" value="${param ? param.name : ''}" required>
        <select class="select" name="paramType">
          <option value="string" ${param && param.type === 'string' ? 'selected' : ''}>string</option>
          <option value="number" ${param && param.type === 'number' ? 'selected' : ''}>number</option>
          <option value="boolean" ${param && param.type === 'boolean' ? 'selected' : ''}>boolean</option>
        </select>
        <input type="text" class="input" name="paramDescription" placeholder="Param Description" value="${param ? param.description || '' : ''}">
        <button type="button" class="button button-danger" onclick="removeParameter('${parameterId}')">×</button>
      </div>
      <div class="error-text"></div>
    `

    parametersContainer.appendChild(paramDiv)
  }

  // Validate form
  function validateForm() {
    let isValid = true
    clearFormErrors()

    if (!toolName.value.trim()) {
      toolNameError.textContent = 'Tool name is required'
      isValid = false
    }

    if (!toolDescription.value.trim()) {
      toolDescriptionError.textContent = 'Tool description is required'
      isValid = false
    }

    // Validate parameters
    const paramRows = parametersContainer.querySelectorAll('.parameter-card')
    paramRows.forEach(row => {
      const nameInput = row.querySelector('[name="paramName"]')
      const errorText = row.querySelector('.error-text')

      if (!nameInput.value.trim()) {
        errorText.textContent = 'Parameter name is required'
        isValid = false
      }
    })

    return isValid
  }

  // Clear form errors
  function clearFormErrors() {
    toolNameError.textContent = ''
    toolDescriptionError.textContent = ''

    const paramErrors = parametersContainer.querySelectorAll('.error-text')
    paramErrors.forEach(error => {
      error.textContent = ''
    })
  }

  // Save tool
  async function saveTool() {
    if (!validateForm()) {
      return
    }

    // Gather parameters
    const parameters = []
    const paramRows = parametersContainer.querySelectorAll('.parameter-card')

    paramRows.forEach(row => {
      const name = row.querySelector('[name="paramName"]').value.trim()
      const type = row.querySelector('[name="paramType"]').value
      const description = row.querySelector('[name="paramDescription"]').value.trim()
      const id = row.dataset.id

      parameters.push({
        id,
        name,
        type,
        description
      })
    })

    const toolData = {
      name: toolName.value.trim(),
      description: toolDescription.value.trim(),
      parameters
    }

    try {
      let response

      if (editingToolName) {
        // Update existing tool
        response = await adminFetch(`/admin/api/tools/${encodeURIComponent(editingToolName)}`, {
          method: 'PUT',
          body: JSON.stringify(toolData)
        })
      } else {
        // Check if tool name already exists
        if (tools.some(tool => tool.name === toolData.name)) {
          toolNameError.textContent = 'Tool name already exists'
          return
        }

        // Add new tool
        response = await adminFetch('/admin/api/tools', {
          method: 'POST',
          body: JSON.stringify(toolData)
        })
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to save tool')
      }

      // Reload tools and hide modal
      await loadApplicationAndTools()
      hideModal()
    } catch (error) {
      // Handle specific errors
      if (error.message.includes('already exists')) {
        toolNameError.textContent = error.message
      } else {
        alert('Error: ' + error.message)
      }
    }
  }

  // Add event listeners for the custom events
  document.addEventListener('editTool', event => {
    const { toolName } = event.detail
    // Find the tool in the global tools array
    const tool = tools.find(t => t.name === toolName)
    if (tool) {
      showModal(toolName)
    }
  })

  document.addEventListener('deleteTool', event => {
    const { toolName } = event.detail
    if (!confirm(`Are you sure you want to delete tool "${toolName}"?`)) {
      return
    }

    adminFetch(`/admin/api/tools/${encodeURIComponent(toolName)}`, { method: 'DELETE' })
      .then(response => {
        if (!response.ok) {
          return response.json().then(errorData => {
            throw new Error(errorData.error || 'Failed to delete tool')
          })
        }

        // Reload tools
        return loadApplicationAndTools()
      })
      .catch(error => {
        alert('Error: ' + error.message)
      })
  })
})

// Global functions for event handlers
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function removeParameter(parameterId) {
  const paramDiv = document.querySelector(`.parameter-card[data-id="${parameterId}"]`)
  if (paramDiv) {
    paramDiv.remove()
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function editTool(toolName) {
  const event = new CustomEvent('editTool', { detail: { toolName } })
  document.dispatchEvent(event)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function deleteTool(toolName) {
  const event = new CustomEvent('deleteTool', { detail: { toolName } })
  document.dispatchEvent(event)
}
